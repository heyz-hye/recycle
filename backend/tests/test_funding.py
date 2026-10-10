from types import SimpleNamespace
from unittest.mock import Mock
from copy import deepcopy
import json
import pytest
from solders.keypair import Keypair
from spl.token.instructions import get_associated_token_address
from app.config import get_settings
from app.db import transaction
from app.services import assets, funding
from app.services.solana_client import SolanaChain
from test_flow import login


def receipt_adapter():
    a = object.__new__(SolanaChain)
    a.issuer = Keypair()
    from solders.pubkey import Pubkey

    mint = Pubkey.from_string(get_settings().solana_usdc_mint)
    a.usdc_mint = lambda: mint
    a.rpc = Mock()
    sig = str(Keypair().sign_message(b"deposit"))
    account = str(get_associated_token_address(a.issuer.pubkey(), mint))
    row = dict(
        accountIndex=0,
        mint=str(mint),
        owner=str(a.issuer.pubkey()),
        uiTokenAmount=dict(amount="20000001", decimals=6),
    )
    result = dict(
        slot=100,
        transaction=dict(
            signatures=[sig],
            message=dict(accountKeys=[dict(pubkey=account, signer=False)]),
        ),
        meta=dict(err=None, preTokenBalances=[], postTokenBalances=[row]),
    )
    return a, sig, result


def set_result(a, result):
    a.rpc.get_transaction.return_value = SimpleNamespace(
        to_json=lambda: json.dumps({"result": result})
    )


def test_verified_deposit_uses_finalized_exact_net_usdc():
    a, sig, result = receipt_adapter()
    set_result(a, result)
    assert a.verify_usdc_deposit(sig)["amount_base_units"] == 20000001
    assert a.rpc.get_transaction.call_args.kwargs["commitment"] == "finalized"
    before = deepcopy(result["meta"]["postTokenBalances"][0])
    before["uiTokenAmount"]["amount"] = "10000000"
    result["meta"]["preTokenBalances"] = [before]
    assert a.verify_usdc_deposit(sig)["amount_base_units"] == 10000001


@pytest.mark.parametrize(
    "problem",
    [
        "pending",
        "failed",
        "wrong_wallet",
        "wrong_mint",
        "wrong_owner",
        "wrong_decimals",
        "wrong_signature",
        "outgoing",
        "internal_transfer",
    ],
)
def test_invalid_deposits_are_rejected(problem):
    a, sig, result = receipt_adapter()
    if problem == "pending":
        result = None
    elif problem == "failed":
        result["meta"]["err"] = {"InstructionError": [0, "failed"]}
    elif problem == "wrong_wallet":
        result["transaction"]["message"]["accountKeys"][0]["pubkey"] = str(
            Keypair().pubkey()
        )
    elif problem == "wrong_signature":
        result["transaction"]["signatures"][0] = str(Keypair().sign_message(b"other"))
    elif problem in ("wrong_mint", "wrong_owner"):
        result["meta"]["postTokenBalances"][0][
            "mint" if problem == "wrong_mint" else "owner"
        ] = str(Keypair().pubkey())
    elif problem == "wrong_decimals":
        result["meta"]["postTokenBalances"][0]["uiTokenAmount"]["decimals"] = 9
    else:
        before = deepcopy(result["meta"]["postTokenBalances"][0])
        before["uiTokenAmount"]["amount"] = "30000000"
        if problem == "internal_transfer":
            before["accountIndex"] = 1
        result["meta"]["preTokenBalances"] = [before]
    set_result(a, result)
    with pytest.raises(ValueError):
        a.verify_usdc_deposit(sig)


def test_manual_funding_disabled_and_roles_enforced(client, monkeypatch):
    signature = str(Keypair().sign_message(b"deposit"))
    login(client)
    assert (
        client.post("/api/funding/deposits", json={"signature": signature}).status_code
        == 403
    )
    login(client, "verifier")
    assert (
        client.post("/api/funding/deposits", json={"signature": signature}).status_code
        == 403
    )
    login(client, "partner")
    assert (
        client.post("/api/funding/deposits", json={"signature": signature}).status_code
        == 409
    )
    from app.schemas import FundingInput
    from app.services.rewards import deposit
    from fastapi import HTTPException

    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with transaction() as c:
        with pytest.raises(HTTPException) as failure:
            deposit(
                c,
                {"id": "partner"},
                FundingInput(amount_cents=100, request_key="manual-no"),
            )
        assert failure.value.status_code == 409
        assert assets.remaining_fund(c) == 0  # Existing $500 demo entry is excluded.


def test_deposit_once_full_precision_and_no_loop_supply_change(client, monkeypatch):
    a, sig, result = receipt_adapter()
    set_result(a, result)
    monkeypatch.setattr("app.services.solana_client.chain", lambda: a)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with transaction() as c:
        first = funding.record_deposit(c, "partner", sig)
        second = funding.record_deposit(c, "partner", sig)
        assert first == second
        assert assets.remaining_fund(c) == 20000001
        assert assets.fund_snapshot(c)["supply_base_units"] == 0
        assert c.one("SELECT COUNT(*) AS n FROM funding_deposits")["n"] == 1
        assert funding.summary(c)["received_usdc_base_units"] == 20000001
    a.rpc.get_transaction.assert_called_once()


def test_bad_deposit_does_not_credit_funding(client, monkeypatch):
    from fastapi import HTTPException

    a, sig, result = receipt_adapter()
    result["meta"]["err"] = "failed"
    set_result(a, result)
    monkeypatch.setattr("app.services.solana_client.chain", lambda: a)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    with transaction() as c:
        with pytest.raises(HTTPException):
            funding.record_deposit(c, "partner", sig)
        assert assets.remaining_fund(c) == 0
        assert c.one("SELECT COUNT(*) AS n FROM funding_deposits")["n"] == 0


def test_government_deposit_endpoint_and_concurrent_replay(client, monkeypatch):
    from concurrent.futures import ThreadPoolExecutor
    from app.main import app
    from app.auth import current_user

    a, sig, result = receipt_adapter()
    set_result(a, result)
    monkeypatch.setattr("app.services.solana_client.chain", lambda: a)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    app.dependency_overrides[current_user] = lambda: {
        "id": "partner",
        "role": "funding_partner",
    }
    try:

        def post():
            return client.post("/api/funding/deposits", json={"signature": sig})

        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda _: post(), range(2)))
        assert [r.status_code for r in results] == [200, 200]
        assert results[-1].json()["usdc"]["received_usdc_base_units"] == 20000001
        assert (
            client.post(
                "/api/funding",
                json={"amount_cents": 100, "request_key": "blocked-manual"},
            ).status_code
            == 409
        )
    finally:
        app.dependency_overrides.pop(current_user, None)
    a.rpc.get_transaction.assert_called_once()


def test_verified_pool_deducts_conversion_once_and_invalidates_old_quotes(
    client, monkeypatch
):
    from test_assets import earned
    from app.schemas import ConversionQuoteInput, ConversionInput
    from fastapi import HTTPException

    earned(client)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    monkeypatch.setattr(assets, "treasury_available", lambda c, asset: 500000000)
    with transaction() as c:
        c.execute(
            "INSERT INTO funding_deposits VALUES ('first',20000000,'treasury','4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',1,NULL,1)"
        )
        user = c.one("SELECT * FROM users WHERE id='recycler'")
        q = assets.quote(
            c, user, ConversionQuoteInput(asset="USDC", loop_base_units=1000)
        )
        assert q["output_base_units"] == 5000000  # 20 USDC / 40 LOOP * 10 LOOP
        c.execute(
            "INSERT INTO funding_deposits VALUES ('second',20000000,'treasury','4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU',2,NULL,2)"
        )
        with pytest.raises(HTTPException, match="Fund value or LOOP supply changed"):
            assets.convert(
                c, user, ConversionInput(quote_id=q["id"], request_key="old-quote")
            )
        q = assets.quote(
            c, user, ConversionQuoteInput(asset="USDC", loop_base_units=1000)
        )
        assert q["output_base_units"] == 10000000
        assets.convert(
            c, user, ConversionInput(quote_id=q["id"], request_key="new-quote")
        )
        assert assets.remaining_fund(c) == 30000000
        assert assets.fund_snapshot(c)["supply_base_units"] == 3000


def test_prepare_deposit_requires_government_role_and_does_not_credit(
    client, monkeypatch
):
    from app.main import app
    from app.auth import current_user

    body = {"source_wallet": str(Keypair().pubkey()), "amount_base_units": 20000000}
    login(client)
    assert client.post("/api/funding/prepare", json=body).status_code == 403
    login(client, "verifier")
    assert client.post("/api/funding/prepare", json=body).status_code == 403
    login(client, "partner")
    assert client.post("/api/funding/prepare", json=body).status_code == 409
    a = Mock()
    a.prepare_funding_deposit.return_value = {"transaction_b64": "unsigned"}
    monkeypatch.setattr("app.services.solana_client.chain", lambda: a)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    app.dependency_overrides[current_user] = lambda: {
        "id": "partner",
        "role": "funding_partner",
    }
    try:
        assert client.post("/api/funding/prepare", json=body).status_code == 200
        a.prepare_funding_deposit.assert_called_once_with(
            body["source_wallet"], 20000000
        )
        for amount in [0, -1, 0.1, True, 1000000000001]:
            assert (
                client.post(
                    "/api/funding/prepare", json={**body, "amount_base_units": amount}
                ).status_code
                == 422
            )
        with transaction(write=False) as c:
            assert assets.remaining_fund(c) == 0
            assert c.one("SELECT COUNT(*) AS n FROM funding_deposits")["n"] == 0
    finally:
        app.dependency_overrides.pop(current_user, None)


def test_mock_funding_excludes_circle_receipts_and_old_quotes(client, monkeypatch):
    from test_assets import earned
    from app.schemas import ConversionQuoteInput, ConversionInput
    from fastapi import HTTPException

    earned(client)
    monkeypatch.setattr(get_settings(), "app_mode", "devnet")
    monkeypatch.setattr(assets, "treasury_available", lambda c, asset: 999999999999)
    circle = get_settings().solana_usdc_mint
    mock_mint = str(Keypair().pubkey())
    with transaction() as c:
        c.execute(
            "INSERT INTO funding_deposits VALUES ('circle-fund',20000000,'treasury',?,1,NULL,1)",
            (circle,),
        )
        user = c.one("SELECT * FROM users WHERE id='recycler'")
        q = assets.quote(
            c, user, ConversionQuoteInput(asset="USDC", loop_base_units=100)
        )
        monkeypatch.setattr(get_settings(), "solana_usdc_mint", mock_mint)
        monkeypatch.setattr(get_settings(), "mock_usdc_enabled", True)
        assert assets.remaining_fund(c) == 0
        c.execute(
            "INSERT INTO funding_deposits VALUES ('mock-fund',10000000000,'treasury',?,2,NULL,2)",
            (mock_mint,),
        )
        assert assets.remaining_fund(c) == 10000000000
        with pytest.raises(HTTPException, match="different funding token"):
            funding.record_deposit(c, "partner", "circle-fund")
        with pytest.raises(HTTPException, match="Funding token changed"):
            assets.convert(
                c,
                user,
                ConversionInput(quote_id=q["id"], request_key="old-circle-quote"),
            )
        assert funding.summary(c)["received_usdc_base_units"] == 10000000000


def test_cannot_relabel_existing_usdc_balances_as_mock(client, monkeypatch):
    from test_assets import earned
    from app.schemas import ConversionQuoteInput, ConversionInput
    from app.seed import seed

    earned(client)
    with transaction() as c:
        user = c.one("SELECT * FROM users WHERE id='recycler'")
        q = assets.quote(
            c, user, ConversionQuoteInput(asset="USDC", loop_base_units=100)
        )
        assets.convert(
            c,
            user,
            ConversionInput(quote_id=q["id"], request_key="prior-circle-credit"),
        )
        c.execute("UPDATE app_metadata SET value='devnet' WHERE key='mode'")
        monkeypatch.setattr(get_settings(), "app_mode", "devnet")
        monkeypatch.setattr(get_settings(), "solana_usdc_mint", str(Keypair().pubkey()))
        monkeypatch.setattr(get_settings(), "mock_usdc_enabled", True)
        with pytest.raises(ValueError, match="Cannot change the USDC mint"):
            seed(c)
