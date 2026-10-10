import json
import stat

import pytest
from app.config import get_settings
from app.db import initialize, transaction
from app.services.test_accounts import create_test_accounts
from app.worker import tick
from fastapi import HTTPException

ITEM = {"material": "bottles", "unit": "count", "quantity": 2}
APPROVE = {"decision": "approved", "received": True, "items": [ITEM]}


def sign_in(client, account):
    result = client.post(
        "/api/auth/login", json={k: account[k] for k in ("email", "password")}
    )
    assert result.status_code == 200
    assert result.json()["role"] == account["role"]
    return result.json()


def test_individual_roles_site_isolation_and_manager_funding(
    client, tmp_path, monkeypatch
):
    # Exercise email accounts without access to shared demo identities.
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "false")
    get_settings.cache_clear()
    output = tmp_path / "logins.json"
    create_test_accounts(output)
    assert stat.S_IMODE(output.stat().st_mode) == 0o600
    recycler, greenhill, riverside, manager = json.loads(output.read_text())["accounts"]
    assert len({a["password"] for a in (recycler, greenhill, riverside, manager)}) == 4
    with transaction() as c:
        c.execute("UPDATE funding_account SET available_cents=0 WHERE id='main'")
        assert c.one("SELECT COUNT(*) AS n FROM claims")["n"] == 0
        for a in (recycler, greenhill, riverside, manager):
            assert (
                a["password"]
                not in c.one(
                    "SELECT password_hash FROM account_credentials WHERE email=?",
                    (a["email"],),
                )["password_hash"]
            )

    sign_in(client, recycler)
    claims = []
    for site in ("test-greenhill", "test-riverside"):
        result = client.post("/api/claims", json={"center_id": site, "items": [ITEM]})
        assert result.status_code == 201
        claims.append(result.json())
    assert (
        client.post(f"/api/claims/{claims[0]['id']}/confirm", json=APPROVE).status_code
        == 403
    )
    assert (
        client.post(
            "/api/funding",
            json={"amount_cents": 1000, "request_key": "forbidden-recycler"},
        ).status_code
        == 403
    )
    for worker, own, other in (
        (greenhill, claims[0], claims[1]),
        (riverside, claims[1], claims[0]),
    ):
        me = sign_in(client, worker)
        assert me["center_id"] == own["center_id"]
        assert me["job_title"] == "Recycling intake worker"
        assert "TEST ONLY" in me["job_location"]
        assert [c["id"] for c in client.get("/api/claims").json()] == [own["id"]]
        assert client.get(f"/api/claims/{other['id']}").status_code == 403
        assert (
            client.post(
                "/api/claims/ticket", json={"ticket": other["ticket"]}
            ).status_code
            == 403
        )
        assert (
            client.post(f"/api/claims/{other['id']}/confirm", json=APPROVE).status_code
            == 403
        )
        assert (
            client.post(
                f"/api/claims/{other['id']}/confirm",
                json={"decision": "rejected", "reason": "Wrong site"},
            ).status_code
            == 403
        )
        assert (
            client.post(
                "/api/funding",
                json={"amount_cents": 1000, "request_key": "forbidden-worker"},
            ).status_code
            == 403
        )
        assert client.get("/api/funding").status_code == 403
        assert (
            client.post(
                "/api/claims/ticket", json={"ticket": own["ticket"]}
            ).status_code
            == 200
        )
        confirmed = client.post(f"/api/claims/{own['id']}/confirm", json=APPROVE)
        assert confirmed.status_code == 200
        assert confirmed.json()["verification"]["verifier_id"] == me["id"]
        assert confirmed.json()["reward"]["state"] == "awaiting_funding"
        assert (
            client.post(f"/api/claims/{own['id']}/confirm", json=APPROVE).json()[
                "reward"
            ]["id"]
            == confirmed.json()["reward"]["id"]
        )

    me = sign_in(client, manager)
    assert me["government_agency"] == "TEST ONLY — Government Recycling Agency"
    assert me["government_department"] == "Environmental Services (test)"
    assert me["job_title"] == "Government fund manager"
    assert me["center_id"] is None
    assert (
        client.post(
            "/api/claims", json={"center_id": "test-greenhill", "items": [ITEM]}
        ).status_code
        == 403
    )
    assert (
        client.post(
            "/api/claims/ticket", json={"ticket": claims[0]["ticket"]}
        ).status_code
        == 403
    )
    assert (
        client.post(f"/api/claims/{claims[0]['id']}/confirm", json=APPROVE).status_code
        == 403
    )
    assert client.get("/api/funding").json()["awaiting_funding"] == 2
    funding = {"amount_cents": 1000, "request_key": "government-budget-test"}
    first = client.post("/api/funding", json=funding)
    assert first.status_code == 200
    assert first.json()["awaiting_funding"] == 0
    assert client.post("/api/funding", json=funding).json() == first.json()
    assert (
        client.post("/api/funding", json={**funding, "amount_cents": 2000}).status_code
        == 409
    )
    with transaction(write=False) as c:
        deposits = c.all("SELECT * FROM funding_ledger WHERE actor_id=?", (me["id"],))
        assert len(deposits) == 1 and deposits[0]["amount_cents"] == 1000
        assert c.one("SELECT COUNT(*) AS n FROM rewards")["n"] == 2
    tick()
    tick()
    sign_in(client, recycler)
    assert client.get("/api/wallet").json()["balance_base_units"] == 2000
    initialize()  # Repeatable schema preserves role profiles and completed work.
    assert (
        sign_in(client, manager)["government_department"] == me["government_department"]
    )


def test_test_account_provisioning_never_overwrites_and_requires_simulation(
    client, tmp_path, monkeypatch
):
    output = tmp_path / "logins.json"
    create_test_accounts(output)
    original = output.read_bytes()
    with pytest.raises(FileExistsError):
        create_test_accounts(output)
    assert output.read_bytes() == original
    with pytest.raises(HTTPException, match="already exist"):
        create_test_accounts(tmp_path / "duplicate.json")
    assert not (tmp_path / "duplicate.json").exists()
    monkeypatch.setenv("APP_MODE", "devnet")
    get_settings.cache_clear()
    with pytest.raises(HTTPException, match="simulated"):
        create_test_accounts(tmp_path / "devnet.json")
    assert not (tmp_path / "devnet.json").exists()


def test_operator_cli_creates_government_manager(client, monkeypatch, capsys):
    from app import cli

    password = "Government account test passphrase"
    monkeypatch.setattr(cli, "getpass", lambda prompt: password)
    monkeypatch.setattr(
        "sys.argv",
        [
            "loopmint",
            "create-account",
            "--email",
            "official@example.com",
            "--name",
            "Test Official",
            "--role",
            "fund_manager",
            "--organization",
            "Test Government Agency",
            "--department",
            "Environmental Services",
        ],
    )
    cli.main()
    me = sign_in(
        client,
        {
            "email": "official@example.com",
            "password": password,
            "role": "funding_partner",
        },
    )
    assert me["government_agency"] == "Test Government Agency"
    assert me["government_department"] == "Environmental Services"
    assert me["job_title"] == "Fund manager"
    assert password not in capsys.readouterr().out


def test_signup_cannot_assign_government_profile(client):
    result = client.post(
        "/api/auth/register",
        json={
            "email": "fake@example.com",
            "username": "Fake Official",
            "password": "Government account test passphrase",
            "government_department": "Environment",
            "government_agency": "Government",
        },
    )
    assert result.status_code == 422
