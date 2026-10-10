from concurrent.futures import ThreadPoolExecutor
from solders.keypair import Keypair
from app.db import transaction
from app.config import get_settings
from app.seed import seed
from app.schemas import WithdrawalInput, ConversionInput
from app.services import assets
from app.services.solana_client import DemoChain
from app.worker import tick
from test_flow import submit, opened, approve, login


def earned(client):
    claim = submit(client)
    opened(client, claim)
    assert approve(client, claim).status_code == 200
    tick()
    tick()
    login(client)
    return claim


def link_test_wallet(client):
    # Exercise the actual proof-of-ownership route on an email account.
    email = "wallet-test@example.com"
    password = "local-test-password-long"
    account = client.post(
        "/api/auth/register",
        json={"email": email, "password": password, "username": "Wallet test"},
    ).json()
    pair = Keypair()
    challenge = client.post(
        "/api/auth/challenge", json={"wallet": str(pair.pubkey())}
    ).json()
    result = client.post(
        "/api/auth/link-wallet",
        json={
            "challenge_id": challenge["challenge_id"],
            "signature": str(pair.sign_message(challenge["message"].encode())),
        },
    )
    assert result.status_code == 200
    return account, str(pair.pubkey())


def move_earnings(client):
    claim = earned(client)
    account, wallet = link_test_wallet(client)
    with transaction() as c:
        c.execute(
            "UPDATE claims SET user_id=? WHERE id=?", (account["id"], claim["id"])
        )
        c.execute(
            "UPDATE rewards SET user_id=? WHERE claim_id=?",
            (account["id"], claim["id"]),
        )
    return account, wallet


def test_fund_based_conversion_and_all_three_wallet_withdrawals(client):
    account, wallet = move_earnings(client)
    original = client.get("/api/assets").json()
    assert original["valuation"] == {
        "fund_usd_micros": 500000000,
        "supply_base_units": 4000,
    }
    assert original["balances"]["LOOP"]["available_base_units"] == 4000
    # $500 / 40 LOOP = $12.50/LOOP. Convert 10 LOOP -> 125 USDC.
    quote = client.post(
        "/api/assets/quotes", json={"asset": "USDC", "loop_base_units": 1000}
    ).json()
    assert quote["output_base_units"] == 125000000
    body = {"quote_id": quote["id"], "request_key": "convert-usdc"}
    result = client.post("/api/assets/conversions", json=body)
    assert result.status_code == 200
    assert (
        client.post("/api/assets/conversions", json=body).json()["id"]
        == result.json()["id"]
    )
    assert (
        client.post(
            "/api/assets/conversions", json={**body, "request_key": "another-key"}
        ).json()["id"]
        == result.json()["id"]
    )
    # Removing pro-rata backing and LOOP preserves the per-coin rate.
    q2 = client.post(
        "/api/assets/quotes", json={"asset": "SOL", "loop_base_units": 1000}
    ).json()
    assert q2["fund_usd_micros"] == 375000000
    assert q2["supply_base_units"] == 3000
    assert q2["output_base_units"] == 1250000000  # demo $100/SOL fixture
    assert (
        client.post(
            "/api/assets/conversions",
            json={"quote_id": q2["id"], "request_key": "convert-sol"},
        ).status_code
        == 200
    )
    for asset, amount in (("LOOP", 1000), ("USDC", 125000000), ("SOL", 1250000000)):
        body = {
            "asset": asset,
            "amount_base_units": amount,
            "destination": wallet,
            "request_key": "withdraw-" + asset,
        }
        first = client.post("/api/assets/withdrawals", json=body)
        assert first.status_code == 201, first.text
        assert (
            client.post("/api/assets/withdrawals", json=body).json()["id"]
            == first.json()["id"]
        )
        assert (
            client.post(
                "/api/assets/withdrawals",
                json={**body, "amount_base_units": amount + 1},
            ).status_code
            == 409
        )
    pending = client.get("/api/assets").json()
    assert pending["balances"]["LOOP"]["available_base_units"] == 1000
    assert pending["balances"]["USDC"]["available_base_units"] == 0
    assert pending["balances"]["SOL"]["pending_base_units"] == 1250000000
    assert (
        pending["valuation"]["supply_base_units"] == 2000
    )  # withdrawn LOOP still exists
    tick()
    tick()
    complete = client.get("/api/assets").json()
    assert all(w["state"] == "confirmed" for w in complete["withdrawals"])
    assert all(w["destination"] == wallet for w in complete["withdrawals"])
    assert complete["balances"]["SOL"]["available_base_units"] == 0
    assert complete["balances"]["SOL"]["pending_base_units"] == 0
    assert client.get("/api/wallet").json()["balance_base_units"] == 1000
    assert client.get("/api/wallet").json()["totals"]["reward_base_units"] == 4000


def test_quotes_expire_change_and_enforce_owner_role_and_liquidity(client, monkeypatch):
    earned(client)
    q = client.post(
        "/api/assets/quotes", json={"asset": "USDC", "loop_base_units": 1000}
    ).json()
    with transaction() as c:
        c.execute("UPDATE conversion_quotes SET expires_at=0 WHERE id=?", (q["id"],))
    body = {"quote_id": q["id"], "request_key": "expired-quote"}
    assert client.post("/api/assets/conversions", json=body).status_code == 409
    q = client.post(
        "/api/assets/quotes", json={"asset": "USDC", "loop_base_units": 1000}
    ).json()
    with transaction() as c:
        c.execute(
            "UPDATE funding_account SET received_cents=received_cents+100 WHERE id='main'"
        )
    body["quote_id"] = q["id"]
    assert client.post("/api/assets/conversions", json=body).status_code == 409
    login(client, "partner")
    assert client.post("/api/assets/conversions", json=body).status_code == 403
    client.post(
        "/api/auth/register",
        json={
            "email": "other@example.com",
            "password": "another-long-password",
            "username": "Other",
        },
    )
    assert client.post("/api/assets/conversions", json=body).status_code == 404
    assert client.get("/api/assets").json()["conversions"] == []
    login(client)
    monkeypatch.setattr(assets, "treasury_available", lambda c, asset: 0)
    assert (
        client.post(
            "/api/assets/quotes", json={"asset": "USDC", "loop_base_units": 1000}
        ).status_code
        == 409
    )
    assert (
        client.get("/api/assets").json()["balances"]["LOOP"]["available_base_units"]
        == 4000
    )


def test_withdraw_requires_verified_wallet_and_converted_balance(client):
    earned(client)
    payload = {
        "asset": "LOOP",
        "amount_base_units": 100,
        "destination": str(Keypair().pubkey()),
        "request_key": "unlinked-wallet",
    }
    assert client.post("/api/assets/withdrawals", json=payload).status_code == 400
    account, wallet = link_test_wallet(client)
    payload["destination"] = wallet
    assert client.post("/api/assets/withdrawals", json=payload).status_code == 409
    assert (
        client.post(
            "/api/assets/withdrawals", json={**payload, "asset": "USDC"}
        ).status_code
        == 409
    )
    assert (
        client.post(
            "/api/assets/withdrawals", json={**payload, "amount_base_units": 0}
        ).status_code
        == 422
    )
    assert (
        client.post(
            "/api/assets/withdrawals", json={**payload, "amount_base_units": 1.5}
        ).status_code
        == 422
    )


def test_concurrent_withdrawals_cannot_spend_same_balance(client):
    account, wallet = move_earnings(client)

    def attempt(n):
        try:
            with transaction() as c:
                return assets.withdraw(
                    c,
                    {**account, "role": "recycler"},
                    WithdrawalInput(
                        asset="LOOP",
                        amount_base_units=4000,
                        destination=wallet,
                        request_key=f"concurrent-{n}",
                    ),
                )
        except Exception as e:
            return e

    with ThreadPoolExecutor(max_workers=2) as pool:
        result = list(pool.map(attempt, (1, 2)))
    assert sum(isinstance(r, dict) for r in result) == 1
    assert (
        client.get("/api/assets").json()["balances"]["LOOP"]["available_base_units"]
        == 0
    )


def test_withdrawal_timeout_and_failure_never_duplicate_or_release_uncertain_funds(
    client,
):
    account, wallet = move_earnings(client)
    body = {
        "asset": "LOOP",
        "amount_base_units": 1000,
        "destination": wallet,
        "request_key": "timeout-test",
    }
    assert client.post("/api/assets/withdrawals", json=body).status_code == 201

    class Timeout(DemoChain):
        prepared = 0
        sent = False

        def prepare_withdrawal(self, row):
            self.prepared += 1
            return super().prepare_withdrawal(row)

        def status(self, row):
            return "confirmed" if self.sent else "missing"

        def broadcast(self, raw):
            with transaction(write=False) as c:
                assert (
                    c.one("SELECT transaction_b64 FROM withdrawals")["transaction_b64"]
                    == raw
                )
            self.sent = True
            raise TimeoutError("Response lost")

    adapter = Timeout()
    assets.process_withdrawals(adapter)
    assets.process_withdrawals(adapter)
    assert adapter.prepared == 1
    assert client.get("/api/assets").json()["withdrawals"][0]["state"] == "confirmed"
    assert (
        client.post(
            "/api/assets/withdrawals", json={**body, "request_key": "failed-test"}
        ).status_code
        == 201
    )

    class Failed(DemoChain):
        def status(self, row):
            return "expired"

    assets.process_withdrawals(Failed())
    overview = client.get("/api/assets").json()
    assert any(w["state"] == "review" for w in overview["withdrawals"])
    assert overview["balances"]["LOOP"]["available_base_units"] == 2000
    assert overview["balances"]["LOOP"]["pending_base_units"] == 1000


def test_devnet_legacy_rewards_are_not_credited_twice(client, monkeypatch):
    earned(client)
    with transaction() as c:
        c.execute("UPDATE reward_custody SET delivery='external'")
        c.execute("UPDATE app_metadata SET value='devnet' WHERE key='mode'")
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with transaction() as c:
        seed(c)
        assert assets.balances(c, "recycler")["LOOP"]["available_base_units"] == 0
        assert assets.fund_snapshot(c)["supply_base_units"] == 4000


def test_new_devnet_reward_is_platform_credit_without_automatic_mint(
    client, monkeypatch
):
    claim = submit(client)
    opened(client, claim)
    approve(client, claim)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    monkeypatch.setattr(get_settings(), "solana_mint", "")
    tick()
    tick()
    with transaction(write=False) as c:
        row = c.one("SELECT * FROM rewards WHERE claim_id=?", (claim["id"],))
        assert row["state"] == "confirmed"
        assert row["signature"].startswith("credit:")
        assert assets.balances(c, "recycler")["LOOP"]["available_base_units"] == 4000


def test_distributed_supply_excludes_treasury_and_zero_supply_cannot_convert(
    client, monkeypatch
):
    from unittest.mock import Mock

    login(client)
    assert client.get("/api/assets").json()["valuation"]["supply_base_units"] == 0
    earned(client)
    # Pricing never reads mint supply or treasury stock: only earned, unredeemed LOOP.
    chain = Mock(
        side_effect=AssertionError("Treasury mint supply must not set the price")
    )
    monkeypatch.setattr("app.services.solana_client.chain", chain)
    snapshot = client.get("/api/assets").json()
    assert snapshot["supply_basis"] == "distributed"
    assert snapshot["valuation"]["supply_base_units"] == 4000
    assert snapshot["valuation"]["fund_usd_micros"] == 500000000
    chain.assert_not_called()


def test_existing_loop_inventory_limits_rewards_and_conversion_releases_stock(
    client, monkeypatch
):
    from unittest.mock import Mock
    from app.services.rewards import fund_waiting
    from app.services.verification import confirm
    from app.schemas import Confirmation, ConversionQuoteInput
    from test_flow import APPROVE

    adapter = Mock()
    adapter.asset_balance.return_value = 0
    monkeypatch.setattr("app.services.solana_client.chain", lambda: adapter)
    claim = submit(client)
    opened(client, claim)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with transaction() as c:
        staff = c.one("SELECT * FROM users WHERE id='verifier'")
        confirm(c, claim["id"], staff, Confirmation(**APPROVE))
        assert c.one("SELECT state FROM rewards")["state"] == "awaiting_funding"
        adapter.asset_balance.return_value = 10000
        fund_waiting(c)
        assert c.one("SELECT state FROM rewards")["state"] == "queued"
        assert assets.loop_inventory_available(c) == 6000
    tick()
    tick()
    adapter.asset_balance.side_effect = lambda asset: (
        10000 if asset == "LOOP" else 1000000000
    )
    with transaction() as c:
        user = c.one("SELECT * FROM users WHERE id='recycler'")
        q = assets.quote(
            c, user, ConversionQuoteInput(asset="USDC", loop_base_units=1000)
        )
        assert q["supply_base_units"] == 4000
        assert q["output_base_units"] == 125000000
        assets.convert(
            c, user, ConversionInput(quote_id=q["id"], request_key="release-stock")
        )
        assert assets.loop_inventory_available(c) == 7000
        assert assets.fund_snapshot(c) == {
            "fund_usd_micros": 375000000,
            "supply_base_units": 3000,
        }


def test_unconfirmed_ticket_cannot_create_or_process_a_reward(client):
    import pytest
    from fastapi import HTTPException
    from unittest.mock import Mock
    from app.services.rewards import create_reward

    claim = submit(client)
    with transaction() as c:
        with pytest.raises(HTTPException) as failure:
            create_reward(c, claim, 4000)
        assert failure.value.status_code == 409
        assert c.one("SELECT COUNT(*) AS n FROM rewards")["n"] == 0
    opened(client, claim)
    assert approve(client, claim).status_code == 200
    with transaction() as c:
        c.execute("DELETE FROM verifications WHERE claim_id=?", (claim["id"],))
    adapter = Mock()
    tick(adapter)
    adapter.prepare.assert_not_called()
    with transaction() as c:
        assert c.one("SELECT state FROM rewards")["state"] == "queued"
        assert c.one("SELECT needs_review FROM reward_jobs")["needs_review"] == 1
