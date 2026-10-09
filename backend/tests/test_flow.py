from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
import pytest
from solders.keypair import Keypair
from app.db import transaction
from app.worker import tick
from app.schemas import Confirmation
from app.services.verification import confirm
from app.services.solana_client import DemoChain
from app.services.common import now

ITEM = {"material": "cardboard", "quantity": 2000, "unit": "grams"}
APPROVE = {"decision": "approved", "received": True, "items": [ITEM]}


def login(c, who="recycler"):
    assert c.post("/api/auth/demo", json={"account": who}).status_code == 200


def submit(c, items=None):
    login(c)
    r = c.post(
        "/api/claims", json={"center_id": "greenpoint", "items": items or [ITEM]}
    )
    assert r.status_code == 201, r.text
    return r.json()


def opened(c, claim):
    login(c, "verifier")
    r = c.post("/api/claims/ticket", json={"ticket": claim["ticket"]})
    assert r.status_code == 200, r.text


def approve(c, claim, body=None):
    return c.post(f"/api/claims/{claim['id']}/confirm", json=body or APPROVE)


def test_full_flow_share_has_no_server_posts_and_redemption(client):
    claim = submit(client)
    assert client.get("/api/wallet").json()["balance_base_units"] == 0
    opened(client, claim)
    assert client.get("/api/claims/" + claim["id"]).json()["reward"] is None
    r = approve(client, claim)
    assert r.status_code == 200
    assert r.json()["reward"]["amount_base_units"] == 4000
    assert r.json()["reward"]["state"] == "queued"
    login(client)
    assert client.get("/api/wallet").json()["balance_base_units"] == 0
    tick()
    assert client.get("/api/wallet").json()["rewards"][0]["state"] == "sent"
    tick()
    wallet = client.get("/api/wallet").json()
    assert wallet["balance_base_units"] == 4000
    assert wallet["rewards"][0]["signature"].startswith("demo:")
    stats = client.get("/api/impact").json()
    assert (
        stats["cardboard_grams"],
        stats["dropoffs"],
        stats["reward_base_units"],
    ) == (2000, 1, 4000)
    body = {"amount_base_units": 1000, "request_key": "redemption-001"}
    first = client.post("/api/redemptions", json=body)
    assert first.status_code == 201
    assert first.json()["payout_cents"] == 10
    assert first.json()["state"] == "completed"
    assert client.post("/api/redemptions", json=body).json()["id"] == first.json()["id"]
    assert client.get("/api/wallet").json()["balance_base_units"] == 3000
    assert client.get("/api/posts").status_code == 404
    login(client, "partner")
    f = client.get("/api/funding").json()
    assert (
        f["available_cents"],
        f["reserved_cents"],
        f["issued_cents"],
        f["redeemed_cents"],
    ) == (49960, 0, 40, 10)


def test_unconfirmed_unauthorized_wrong_center_and_self_approval(client):
    claim = submit(client)
    assert approve(client, claim).status_code == 403
    assert (
        client.post(
            "/api/funding", json={"amount_cents": 100, "request_key": "not-allowed"}
        ).status_code
        == 403
    )
    with transaction() as c:
        c.execute("INSERT INTO centers VALUES ('other','Other','Other')")
        c.execute("UPDATE users SET center_id='other' WHERE id='verifier'")
    login(client, "verifier")
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 403
    )
    assert approve(client, claim).status_code == 403
    with transaction() as c:
        c.execute("UPDATE users SET center_id='greenpoint' WHERE id='verifier'")
        c.execute("UPDATE claims SET user_id='verifier' WHERE id=?", (claim["id"],))
    assert approve(client, claim).status_code == 403
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM rewards")["n"] == 0
        assert (
            c.one("SELECT reserved_cents FROM funding_account WHERE id='main'")[
                "reserved_cents"
            ]
            == 0
        )


def test_cannot_approve_before_opening_ticket(client):
    claim = submit(client)
    login(client, "verifier")
    assert approve(client, claim).status_code == 409


def test_rejection_cannot_issue(client):
    claim = submit(client)
    opened(client, claim)
    r = approve(
        client,
        claim,
        {"decision": "rejected", "reason": "Wet and contaminated cardboard"},
    )
    assert r.status_code == 200
    assert r.json()["status"] == "rejected"
    assert r.json()["reward"] is None
    assert approve(client, claim).status_code == 409
    tick()
    assert client.get("/api/impact").json()["dropoffs"] == 0


@pytest.mark.parametrize(
    "body",
    [
        {"decision": "approved", "received": False, "items": [ITEM]},
        {"decision": "approved", "received": True, "items": []},
        {"decision": "approved", "received": True, "items": [{**ITEM, "quantity": -1}]},
        {"decision": "approved", "received": True, "items": [{**ITEM, "quantity": 0}]},
        {
            "decision": "approved",
            "received": True,
            "items": [{**ITEM, "quantity": 1.5}],
        },
        {
            "decision": "approved",
            "received": True,
            "items": [{**ITEM, "quantity": "2000"}],
        },
        {
            "decision": "approved",
            "received": True,
            "items": [{**ITEM, "unit": "count"}],
        },
        {
            "decision": "approved",
            "received": True,
            "items": [{**ITEM, "material": "glass"}],
        },
        {"decision": "approved", "received": True, "items": [ITEM, ITEM]},
        {"decision": "rejected", "reason": ""},
        {"decision": "rejected", "reason": "No", "items": [ITEM]},
    ],
)
def test_invalid_intake(client, body):
    claim = submit(client)
    opened(client, claim)
    assert approve(client, claim, body).status_code == 422
    assert client.get("/api/claims/" + claim["id"]).json()["reward"] is None


def test_duplicate_and_concurrent_approval(client):
    claim = submit(client)
    opened(client, claim)
    with transaction(write=False) as c:
        user = c.one("SELECT * FROM users WHERE id='verifier'")

    def decide(_):
        with transaction() as c:
            return confirm(c, claim["id"], user, Confirmation(**APPROVE))["reward"][
                "id"
            ]

    with ThreadPoolExecutor(max_workers=4) as pool:
        results = list(pool.map(decide, range(8)))
    assert len(set(results)) == 1
    assert approve(client, claim).status_code == 200
    assert (
        approve(
            client, claim, {**APPROVE, "items": [{**ITEM, "quantity": 1000}]}
        ).status_code
        == 409
    )
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM rewards")["n"] == 1
        assert c.one("SELECT COUNT(*) AS n FROM reward_jobs")["n"] == 1
        assert (
            c.one("SELECT COUNT(*) AS n FROM funding_ledger WHERE kind='reserved'")["n"]
            == 1
        )
        assert (
            c.one(
                "SELECT COUNT(*) AS n FROM recycling_events WHERE event_type='intake'"
            )["n"]
            == 1
        )


def test_budget_contention_and_funding_retry(client):
    a = submit(client)
    b = submit(client)
    opened(client, a)
    opened(client, b)
    with transaction() as c:
        c.execute(
            "UPDATE funding_account SET available_cents=40,received_cents=40 WHERE id='main'"
        )
        user = c.one("SELECT * FROM users WHERE id='verifier'")

    def decide(claim):
        with transaction() as c:
            return confirm(c, claim["id"], user, Confirmation(**APPROVE))["reward"][
                "state"
            ]

    with ThreadPoolExecutor(max_workers=2) as pool:
        states = list(pool.map(decide, [a, b]))
    assert sorted(states) == ["awaiting_funding", "queued"]
    login(client, "partner")
    body = {"amount_cents": 40, "request_key": "funding-retry-001"}
    assert client.post("/api/funding", json=body).status_code == 200
    assert client.post("/api/funding", json=body).json()["received_cents"] == 80
    assert (
        client.post("/api/funding", json={**body, "amount_cents": 41}).status_code
        == 409
    )
    tick()
    tick()
    tick()
    f = client.get("/api/funding").json()
    assert (f["available_cents"], f["issued_cents"], f["reserved_cents"]) == (0, 80, 0)


def test_expired_ticket_and_replacement(client):
    claim = submit(client)
    with transaction() as c:
        c.execute(
            "UPDATE claims SET ticket_expires_at=? WHERE id=?", (now() - 1, claim["id"])
        )
    login(client, "verifier")
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 409
    )
    login(client)
    replacement = client.post(f"/api/claims/{claim['id']}/renew", json={}).json()
    assert replacement["ticket"] != claim["ticket"]
    opened(client, replacement)
    assert (
        client.post("/api/claims/ticket", json={"ticket": claim["ticket"]}).status_code
        == 404
    )
    assert approve(client, replacement).status_code == 200
    assert (
        client.post(
            "/api/claims/ticket", json={"ticket": replacement["ticket"]}
        ).status_code
        == 409
    )
    login(client)
    assert client.post(f"/api/claims/{claim['id']}/renew", json={}).status_code == 409


def test_timeout_after_broadcast_never_remints(client):
    claim = submit(client)
    opened(client, claim)
    approve(client, claim)

    class TimeoutChain(DemoChain):
        def __init__(self):
            self.prepared = 0
            self.sent = 0

        def prepare(self, *args):
            self.prepared += 1
            return super().prepare(*args)

        def status(self, job):
            return "confirmed" if self.sent else "missing"

        def broadcast(self, raw):
            with transaction(write=False) as c:
                assert (
                    c.one("SELECT transaction_b64 FROM reward_jobs")["transaction_b64"]
                    == raw
                )
            self.sent += 1
            raise TimeoutError("Broadcast succeeded but response was lost")

    chain = TimeoutChain()
    tick(chain)
    tick(chain)
    tick(chain)
    assert (chain.prepared, chain.sent) == (1, 1)
    with transaction(write=False) as c:
        assert c.one("SELECT state FROM rewards")["state"] == "confirmed"
        assert (
            c.one("SELECT COUNT(*) AS n FROM funding_ledger WHERE kind='issued'")["n"]
            == 1
        )


def test_expired_transaction_stays_reserved_for_reconciliation(client):
    claim = submit(client)
    opened(client, claim)
    approve(client, claim)

    class ExpiredChain(DemoChain):
        def status(self, job):
            return "expired"

        def broadcast(self, raw):
            raise AssertionError("Expired transaction must not be sent")

    tick(ExpiredChain())
    tick(ExpiredChain())
    with transaction(write=False) as c:
        assert c.one("SELECT needs_review FROM reward_jobs")["needs_review"] == 1
        assert (
            c.one("SELECT reserved_cents FROM funding_account WHERE id='main'")[
                "reserved_cents"
            ]
            == 40
        )


def test_accepted_quantities_and_rate_snapshot(client):
    claim = submit(
        client, [{"material": "bottles", "quantity": 10, "unit": "count"}, ITEM]
    )
    opened(client, claim)
    r = approve(
        client,
        claim,
        {
            "decision": "approved",
            "received": True,
            "items": [{"material": "bottles", "quantity": 8, "unit": "count"}],
        },
    )
    assert r.json()["reward"]["amount_base_units"] == 4000
    with transaction() as c:
        c.execute(
            "UPDATE reward_rules SET rate_base_units=9999 WHERE material='bottles'"
        )
    stored = client.get("/api/claims/" + claim["id"]).json()
    assert stored["items"][0]["rate_base_units"] == 500
    assert stored["items"][1]["accepted_quantity"] == 0
    stats = client.get("/api/impact").json()
    assert (stats["bottles"], stats["cardboard_grams"]) == (8, 0)


def test_rounding_reserves_up_and_redemption_never_overdraws(client):
    claim = submit(client, [{**ITEM, "quantity": 1}])
    opened(client, claim)
    r = approve(client, claim, {**APPROVE, "items": [{**ITEM, "quantity": 1}]})
    assert r.json()["reward"]["amount_base_units"] == 2
    assert r.json()["reward"]["cost_cents"] == 1
    tick()
    tick()
    login(client)
    assert (
        client.post(
            "/api/redemptions",
            json={"amount_base_units": 100, "request_key": "too-much"},
        ).status_code
        == 400
    )
    assert (
        client.post(
            "/api/redemptions",
            json={"amount_base_units": 101, "request_key": "fraction"},
        ).status_code
        == 422
    )


def test_wallet_signature_nonce_replay_and_server_assigned_roles(client):
    pair = Keypair()
    challenge = client.post(
        "/api/auth/challenge", json={"wallet": str(pair.pubkey())}
    ).json()
    signed = {
        "challenge_id": challenge["challenge_id"],
        "signature": str(pair.sign_message(challenge["message"].encode())),
        "username": "New recycler",
    }
    response = client.post("/api/auth/verify", json=signed)
    assert response.status_code == 200
    assert response.json()["role"] == "recycler"
    assert "HttpOnly" in response.headers["set-cookie"]
    assert client.post("/api/auth/verify", json=signed).status_code == 401
    assert client.get("/api/funding").status_code == 403
    assert (
        client.post(
            "/api/auth/demo", json={"account": "recycler", "role": "verifier"}
        ).status_code
        == 422
    )


def test_bad_signature_and_cross_origin_blocked(client):
    pair = Keypair()
    other = Keypair()
    challenge = client.post(
        "/api/auth/challenge", json={"wallet": str(pair.pubkey())}
    ).json()
    response = client.post(
        "/api/auth/verify",
        json={
            "challenge_id": challenge["challenge_id"],
            "signature": str(other.sign_message(challenge["message"].encode())),
        },
    )
    assert response.status_code == 401
    assert (
        client.post(
            "/api/auth/demo",
            json={"account": "recycler"},
            headers={"Origin": "https://untrusted.example"},
        ).status_code
        == 403
    )
    assert client.get("/api/claims").status_code == 401


def test_private_claim_access(client):
    claim = submit(client)
    pair = Keypair()
    challenge = client.post(
        "/api/auth/challenge", json={"wallet": str(pair.pubkey())}
    ).json()
    client.post(
        "/api/auth/verify",
        json={
            "challenge_id": challenge["challenge_id"],
            "signature": str(pair.sign_message(challenge["message"].encode())),
        },
    )
    assert client.get("/api/claims/" + claim["id"]).status_code == 403
    assert client.get("/api/claims").json() == []


def test_no_demo_login_in_devnet_mode(client, monkeypatch):
    from app.config import get_settings

    monkeypatch.setenv("APP_MODE", "devnet")
    get_settings.cache_clear()
    assert (
        client.post("/api/auth/demo", json={"account": "verifier"}).status_code == 404
    )
