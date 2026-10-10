import base64
import json
from types import SimpleNamespace
from unittest.mock import Mock
from solders.hash import Hash
from solders.keypair import Keypair
from solders.transaction import Transaction
from app.services.solana_client import SolanaChain
import pytest


def adapter():
    a = object.__new__(SolanaChain)
    a.issuer = Keypair()
    a.mint = Keypair().pubkey()
    a.rpc = Mock()
    a.rpc.get_latest_blockhash.return_value = SimpleNamespace(
        value=SimpleNamespace(blockhash=Hash.new_unique(), last_valid_block_height=99)
    )
    return a


def test_reward_transaction_transfers_treasury_stock_and_is_distinct():
    a = adapter()
    a.check_payout = Mock()
    wallet = str(Keypair().pubkey())
    first = a.prepare({"id": "claim-one", "amount_base_units": 4000}, wallet)
    second = a.prepare({"id": "claim-two", "amount_base_units": 4000}, wallet)
    assert first["signature"] != second["signature"]
    tx = Transaction.from_bytes(base64.b64decode(first["transaction_b64"]))
    tx.verify()
    assert len(tx.message.instructions) == 3
    assert (
        tx.message.instructions[1].data[0] == 12
    )  # SPL TransferChecked; rewards never mint
    assert int.from_bytes(tx.message.instructions[1].data[1:9], "little") == 4000
    assert tx.message.instructions[1].data[9] == 2
    assert tx.message.instructions[2].data == b"LoopMint withdrawal:reward:claim-one"


def signed_burn(a, owner, redemption="redemption-one"):
    raw = a.prepare_burn(str(owner.pubkey()), 1000, redemption)
    tx = Transaction.from_bytes(base64.b64decode(raw))
    tx.sign([owner], tx.message.recent_blockhash)
    return raw, tx


def test_burn_checks_exact_message_signer_mint_amount_and_identity():
    a = adapter()
    owner = Keypair()
    raw, tx = signed_burn(a, owner)
    response = SimpleNamespace(
        to_json=lambda: json.dumps(
            {
                "result": {
                    "meta": {"err": None},
                    "transaction": [base64.b64encode(bytes(tx)).decode(), "base64"],
                }
            }
        )
    )
    a.rpc.get_transaction.return_value = response
    assert a.verify_burn(str(tx.signatures[0]), raw)
    different = a.prepare_burn(str(owner.pubkey()), 1000, "redemption-two")
    with pytest.raises(ValueError, match="does not match"):
        a.verify_burn(str(tx.signatures[0]), different)
    altered = a.prepare_burn(str(owner.pubkey()), 1100, "redemption-one")
    with pytest.raises(ValueError):
        a.verify_burn(str(tx.signatures[0]), altered)
    foreign = a.prepare_burn(str(Keypair().pubkey()), 1000, "redemption-one")
    with pytest.raises(ValueError):
        a.verify_burn(str(tx.signatures[0]), foreign)


def test_unconfirmed_or_failed_burn_is_not_paid():
    a = adapter()
    raw, tx = signed_burn(a, Keypair())
    a.rpc.get_transaction.return_value = SimpleNamespace(
        to_json=lambda: '{"result": null}'
    )
    assert not a.verify_burn(str(tx.signatures[0]), raw)
    a.rpc.get_transaction.return_value = SimpleNamespace(
        to_json=lambda: '{"result": {"meta":{"err":"failed"}}}'
    )
    with pytest.raises(ValueError, match="failed"):
        a.verify_burn(str(tx.signatures[0]), raw)


def test_network_status_and_expiry():
    a = adapter()
    sig = str(Keypair().sign_message(b"test"))
    a.rpc.get_signature_statuses.return_value = SimpleNamespace(value=[None])
    a.rpc.get_block_height.return_value = SimpleNamespace(value=50)
    job = {"signature": sig, "last_valid_block_height": 99}
    assert a.status(job) == "missing"
    a.rpc.get_block_height.return_value = SimpleNamespace(value=100)
    assert a.status(job) == "expired"
    a.rpc.get_signature_statuses.return_value = SimpleNamespace(
        value=[
            SimpleNamespace(
                err=None, confirmation_status="TransactionConfirmationStatus.Confirmed"
            )
        ]
    )
    assert a.status(job) == "confirmed"
    a.rpc.get_signature_statuses.return_value = SimpleNamespace(
        value=[SimpleNamespace(err="failed")]
    )
    assert a.status(job) == "failed"


def test_other_network_is_rejected_before_reading_keypair(monkeypatch):
    from app.config import get_settings

    monkeypatch.setattr(get_settings(), "solana_mint", str(Keypair().pubkey()))
    monkeypatch.setattr(
        get_settings(), "solana_issuer_keypair", "/nonexistent/keypair.json"
    )
    fake = Mock()
    fake.get_genesis_hash.return_value = SimpleNamespace(value="mainnet")
    monkeypatch.setattr("app.services.solana_client.Client", lambda *a, **k: fake)
    with pytest.raises(RuntimeError, match="Only Solana Devnet"):
        SolanaChain()


@pytest.mark.parametrize(
    "asset,amount", [("LOOP", 1234), ("USDC", 1234567), ("SOL", 123456789)]
)
def test_signed_withdrawal_uses_exact_asset_amount_and_destination(asset, amount):
    from spl.token.instructions import get_associated_token_address

    a = adapter()
    owner = Keypair().pubkey()
    a.check_payout = Mock()
    mint = Keypair().pubkey()
    a.usdc_mint = lambda: mint
    row = {
        "id": "withdrawal-one",
        "asset": asset,
        "amount_base_units": amount,
        "destination": str(owner),
    }
    result = a.prepare_withdrawal(row)
    tx = Transaction.from_bytes(base64.b64decode(result["transaction_b64"]))
    tx.verify()
    keys = tx.message.account_keys
    if asset == "SOL":
        ix = tx.message.instructions[0]
        assert int.from_bytes(ix.data[:4], "little") == 2
        assert int.from_bytes(ix.data[4:12], "little") == amount
        assert keys[ix.accounts[1]] == owner
    else:
        ix = tx.message.instructions[1]
        assert ix.data[0] == 12  # TransferChecked, never MintTo
        assert int.from_bytes(ix.data[1:9], "little") == amount
        assert ix.data[9] == (2 if asset == "LOOP" else 6)
        assert (
            get_associated_token_address(owner, a.mint if asset == "LOOP" else mint)
            in keys
        )
    assert b"withdrawal" in tx.message.instructions[-1].data
    assert (
        result["signature"]
        != a.prepare_withdrawal({**row, "id": "withdrawal-two"})["signature"]
    )


def test_existing_nine_decimal_loop_is_transferred_from_treasury():
    from spl.token.instructions import get_associated_token_address

    a = adapter()
    a.loop_decimals = 9
    a.check_payout = Mock()
    owner = Keypair().pubkey()
    row = dict(
        id="existing-loop", asset="LOOP", amount_base_units=125, destination=str(owner)
    )
    tx = Transaction.from_bytes(
        base64.b64decode(a.prepare_withdrawal(row)["transaction_b64"])
    )
    tx.verify()
    ix = tx.message.instructions[1]
    keys = tx.message.account_keys
    assert ix.data[0] == 12  # TransferChecked: no mint authority needed.
    assert int.from_bytes(ix.data[1:9], "little") == 1250000000
    assert ix.data[9] == 9
    assert keys[ix.accounts[0]] == get_associated_token_address(
        a.issuer.pubkey(), a.mint
    )
    assert keys[ix.accounts[1]] == a.mint
    assert keys[ix.accounts[2]] == get_associated_token_address(owner, a.mint)
    a.rpc.get_token_account_balance.return_value = SimpleNamespace(
        value=SimpleNamespace(amount="100000000000")
    )
    assert a.asset_balance("LOOP") == 10000  # 100 LOOP in app accounting units.
