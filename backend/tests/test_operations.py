import pytest
from fastapi import HTTPException
from app.db import transaction, initialize
from app.config import get_settings
from app.services.common import now
from app.worker import tick
from test_flow import submit, opened, approve, login, APPROVE, ITEM


def test_expired_session_cannot_confirm(client):
    claim = submit(client)
    opened(client, claim)
    with transaction() as c:
        c.execute("UPDATE sessions SET expires_at=?", (now() - 1,))
    assert approve(client, claim).status_code == 401
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM verifications")["n"] == 0


def test_center_confirmation_with_expired_open_ticket(client):
    claim = submit(client)
    opened(client, claim)
    with transaction() as c:
        c.execute(
            "UPDATE claims SET ticket_expires_at=? WHERE id=?", (now() - 1, claim["id"])
        )
    assert approve(client, claim).status_code == 409


def test_accepted_unsubmitted_material_rolls_back(client):
    claim = submit(client)
    opened(client, claim)
    result = approve(
        client,
        claim,
        {
            **APPROVE,
            "items": [{"material": "bottles", "quantity": 10, "unit": "count"}],
        },
    )
    assert result.status_code == 400
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM recycling_events")["n"] == 0
        assert (
            c.one("SELECT accepted_quantity FROM claim_items")["accepted_quantity"]
            is None
        )


def test_changing_database_mode_is_rejected(client, monkeypatch):
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with pytest.raises(ValueError, match="separate database"):
        initialize()


def test_insufficient_funding_never_sends_until_reserved(client):
    claim = submit(client)
    opened(client, claim)
    with transaction() as c:
        c.execute("UPDATE funding_account SET available_cents=0 WHERE id='main'")
    result = approve(client, claim)
    assert result.json()["status"] == "verified"
    assert result.json()["reward"]["state"] == "awaiting_funding"
    tick()
    with transaction(write=False) as c:
        assert c.one("SELECT COUNT(*) AS n FROM reward_jobs")["n"] == 0
    assert client.get("/api/impact").json()["cardboard_grams"] == 2000


def test_duplicate_redemption_changed_amount_conflicts(client):
    claim = submit(client)
    opened(client, claim)
    approve(client, claim)
    tick()
    tick()
    login(client)
    assert (
        client.post(
            "/api/redemptions",
            json={"amount_base_units": 100, "request_key": "redemption-key"},
        ).status_code
        == 201
    )
    assert (
        client.post(
            "/api/redemptions",
            json={"amount_base_units": 200, "request_key": "redemption-key"},
        ).status_code
        == 409
    )
    assert client.get("/api/wallet").json()["balance_base_units"] == 3900
