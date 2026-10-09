import hashlib
import pytest
from solders.keypair import Keypair
from app.config import get_settings, Settings
from app.db import initialize, transaction
from app.schemas import Registration
from app.services.accounts import create_account, hash_password
from app.services.common import now

PASSWORD = "correct horse recycling battery"


def register(client, email="alex@example.com", **extra):
    return client.post(
        "/api/auth/register",
        json={
            "email": email,
            "username": "Alex Green",
            "password": PASSWORD,
            **extra,
        },
    )


def provision(email, role, center=None):
    data = Registration(email=email, username="Individual Member", password=PASSWORD)
    hashed = hash_password(PASSWORD)
    with transaction() as c:
        return create_account(
            c, data, hashed, role, center, "Intake specialist", "Green Fund"
        )


def login(client, email, password=PASSWORD):
    return client.post("/api/auth/login", json={"email": email, "password": password})


def wallet_proof(client, key):
    challenge = client.post(
        "/api/auth/challenge", json={"wallet": str(key.pubkey())}
    ).json()
    return {
        "challenge_id": challenge["challenge_id"],
        "signature": str(key.sign_message(challenge["message"].encode())),
    }


def test_individual_registration_login_logout_and_private_credentials(client):
    result = register(client, " ALEX@Example.com ")
    assert result.status_code == 201
    user = result.json()
    assert user["email"] == "alex@example.com"
    assert user["role"] == "recycler" and user["center_id"] is None
    assert "password" not in result.text
    with transaction(write=False) as c:
        stored = c.one(
            "SELECT * FROM account_credentials WHERE user_id=?", (user["id"],)
        )
    assert stored["password_hash"].startswith("scrypt$131072$8$1$")
    assert PASSWORD not in stored["password_hash"]
    assert client.get("/api/auth/me").json()["id"] == user["id"]
    cookie = result.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=strict" in cookie
    client.post("/api/auth/logout")
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, "ALEX@example.com").json()["id"] == user["id"]
    assert register(client).status_code == 409


@pytest.mark.parametrize(
    "extra",
    [
        {"role": "verifier"},
        {"center_id": "greenpoint"},
        {"organization": "My fund"},
        {"password": "short-secret"},
        {"email": "not-an-email"},
        {"username": "   "},
    ],
)
def test_signup_cannot_grant_privileges_or_accept_invalid_credentials(client, extra):
    result = (
        register(client, **extra)
        if "email" not in extra
        else register(client, extra["email"])
    )
    assert result.status_code == 422
    assert PASSWORD not in result.text and "short-secret" not in result.text
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM account_credentials")["n"] == 0


def test_login_failures_generic_and_throttled_with_committed_attempts(client):
    register(client)
    assert login(client, "alex@example.com", "wrong password").status_code == 401
    unknown = login(client, "missing@example.com", "wrong password")
    assert unknown.status_code == 401
    assert unknown.json() == login(client, "alex@example.com", "wrong password").json()
    key = hashlib.sha256(b"email:alex@example.com").hexdigest()
    with transaction() as c:
        c.execute("UPDATE auth_attempts SET attempts=10 WHERE key_hash=?", (key,))
    assert login(client, "alex@example.com").status_code == 429
    with transaction() as c:
        c.execute(
            "UPDATE auth_attempts SET expires_at=? WHERE key_hash=?", (now() - 1, key)
        )
    assert login(client, "alex@example.com").status_code == 200


def test_staff_individual_identity_job_location_and_center_permissions(client):
    with transaction() as c:
        c.execute(
            "INSERT INTO centers VALUES ('greenhill','Greenhill Recycling Center','Greenhill Road')"
        )
    staff = provision("staff@example.com", "verifier", "greenhill")
    other = provision("coworker@example.com", "verifier", "greenhill")
    assert staff["id"] != other["id"]
    register(client)
    claim = client.post(
        "/api/claims",
        json={
            "center_id": "greenhill",
            "items": [{"material": "bottles", "unit": "count", "quantity": 2}],
        },
    ).json()
    login(client, "staff@example.com")
    me = client.get("/api/auth/me").json()
    assert me["job_location"] == "Greenhill Recycling Center"
    assert me["job_title"] == "Intake specialist"
    assert me["center_id"] == "greenhill"
    assert client.get("/api/funding").status_code == 403
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 200
    )
    result = client.post(
        f"/api/claims/{claim['id']}/confirm",
        json={
            "decision": "approved",
            "received": True,
            "items": [{"material": "bottles", "unit": "count", "quantity": 2}],
        },
    )
    assert result.status_code == 200
    with transaction(write=False) as c:
        assert (
            c.one(
                "SELECT verifier_id FROM verifications WHERE claim_id=?", (claim["id"],)
            )["verifier_id"]
            == staff["id"]
        )
    provision("wrongcenter@example.com", "verifier", "greenpoint")
    login(client, "wrongcenter@example.com")
    assert client.get(f"/api/claims/{claim['id']}").status_code == 403


def test_funding_member_login_and_individual_ledger_identity(client):
    member = provision("member@example.com", "funding_partner")
    assert login(client, "member@example.com").json()["organization"] == "Green Fund"
    assert client.get("/api/funding").status_code == 200
    result = client.post(
        "/api/funding",
        json={"amount_cents": 1000, "request_key": "individual-member-deposit"},
    )
    assert result.status_code == 200
    with transaction(write=False) as c:
        assert (
            c.one(
                "SELECT actor_id FROM funding_ledger WHERE reference=?",
                (f"deposit:{member['id']}:individual-member-deposit",),
            )["actor_id"]
            == member["id"]
        )


def test_password_change_revokes_other_sessions(client):
    register(client)
    old_cookie = client.cookies.get("loopmint_session")
    login(client, "alex@example.com")
    assert (
        client.post(
            "/api/auth/password",
            json={"current_password": "wrong", "new_password": PASSWORD + " new"},
        ).status_code
        == 401
    )
    result = client.post(
        "/api/auth/password",
        json={"current_password": PASSWORD, "new_password": PASSWORD + " new"},
    )
    assert result.status_code == 200
    with transaction(write=False) as c:
        assert not c.one(
            "SELECT * FROM sessions WHERE token_hash=?",
            (hashlib.sha256(old_cookie.encode()).hexdigest(),),
        )
        assert c.one("SELECT COUNT(*) AS n FROM sessions")["n"] == 1
    assert client.get("/api/auth/me").status_code == 200
    assert login(client, "alex@example.com").status_code == 401
    assert login(client, "alex@example.com", PASSWORD + " new").status_code == 200


def test_individual_accounts_work_with_demo_accounts_disabled(client, monkeypatch):
    client.post("/api/auth/demo", json={"account": "verifier"})
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "false")
    get_settings.cache_clear()
    assert client.get("/api/health").json()["demo_accounts_enabled"] is False
    assert client.get("/api/auth/me").status_code == 401
    assert (
        client.post("/api/auth/demo", json={"account": "verifier"}).status_code == 404
    )
    assert register(client).status_code == 201


def test_operator_requires_staff_location_and_funder_organization(client):
    from fastapi import HTTPException

    with pytest.raises(HTTPException, match="registered job location"):
        provision("staff@example.com", "verifier")
    with pytest.raises(HTTPException, match="registered job location"):
        provision("staff@example.com", "verifier", "missing")


def test_signed_wallet_link_preserves_identity_and_blocks_other_owner(client):
    user = register(client).json()
    key = Keypair()
    proof = wallet_proof(client, key)
    result = client.post("/api/auth/link-wallet", json=proof)
    assert result.status_code == 200 and result.json()["id"] == user["id"]
    assert result.json()["wallet"] == str(key.pubkey())
    assert client.post("/api/auth/link-wallet", json=proof).status_code == 401
    assert (
        client.post("/api/auth/verify", json=wallet_proof(client, key)).json()["id"]
        == user["id"]
    )
    register(client, "second@example.com")
    assert (
        client.post("/api/auth/link-wallet", json=wallet_proof(client, key)).status_code
        == 409
    )
    login(client, "alex@example.com")
    assert (
        client.post(
            "/api/auth/link-wallet", json=wallet_proof(client, Keypair())
        ).status_code
        == 409
    )


def test_devnet_requires_linked_wallet_before_claim(client, monkeypatch):
    register(client)
    monkeypatch.setenv("APP_MODE", "devnet")
    get_settings.cache_clear()
    result = client.post(
        "/api/claims",
        json={
            "center_id": "greenpoint",
            "items": [{"material": "bottles", "unit": "count", "quantity": 1}],
        },
    )
    assert result.status_code == 400 and "Link your Solana wallet" in result.text


def test_tiger_connections_require_tls():
    with pytest.raises(ValueError, match="sslmode"):
        Settings(
            database_url="postgresql://user:password@demo.tsdb.cloud.timescale.com:5432/tsdb"
        ).validate_runtime()
    Settings(
        database_url="postgresql://user:password@demo.tsdb.cloud.tigerdata.com:5432/tsdb?sslmode=require"
    ).validate_runtime()


def test_additive_account_schema_keeps_legacy_users_and_claims(client):
    client.post("/api/auth/demo", json={"account": "recycler"})
    claim = client.post(
        "/api/claims",
        json={
            "center_id": "greenpoint",
            "items": [{"material": "bottles", "unit": "count", "quantity": 1}],
        },
    ).json()
    with transaction() as c:
        for table in (
            "account_credentials",
            "staff_profiles",
            "funding_member_profiles",
            "auth_attempts",
        ):
            c.execute(f"DROP TABLE {table}")
    initialize()
    assert client.get(f"/api/claims/{claim['id']}").status_code == 200
    assert register(client).status_code == 201


def test_operator_cli_creates_staff_and_resets_password(client, monkeypatch, capsys):
    from app import cli

    monkeypatch.setattr(cli, "getpass", lambda prompt: PASSWORD)
    monkeypatch.setattr(
        "sys.argv",
        [
            "loopmint",
            "create-account",
            "--email",
            "operator-staff@example.com",
            "--name",
            "Sam Intake",
            "--role",
            "staff",
            "--center",
            "greenpoint",
            "--job-title",
            "Intake lead",
        ],
    )
    cli.main()
    user = login(client, "operator-staff@example.com").json()
    assert user["job_title"] == "Intake lead" and user["center_id"] == "greenpoint"
    monkeypatch.setattr(cli, "getpass", lambda prompt: PASSWORD + " reset")
    monkeypatch.setattr(
        "sys.argv",
        ["loopmint", "reset-password", "--email", "operator-staff@example.com"],
    )
    cli.main()
    assert client.get("/api/auth/me").status_code == 401
    assert login(client, "operator-staff@example.com").status_code == 401
    assert (
        login(client, "operator-staff@example.com", PASSWORD + " reset").status_code
        == 200
    )
    assert PASSWORD not in capsys.readouterr().out


def test_new_individual_database_has_no_shared_users_or_sample_centers(
    client, monkeypatch, tmp_path
):
    monkeypatch.setenv("DATABASE_URL", f"sqlite:///{tmp_path}/individual.db")
    monkeypatch.setenv("DEMO_ACCOUNTS_ENABLED", "false")
    get_settings.cache_clear()
    initialize()
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM users")["n"] == 0
        assert c.one("SELECT COUNT(*) AS n FROM centers")["n"] == 0
        assert c.one("SELECT COUNT(*) AS n FROM funding_ledger")["n"] == 0
