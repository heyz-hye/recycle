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


def test_mint_transaction_signed_and_distinct_per_reward():
    a = adapter()
    wallet = str(Keypair().pubkey())
    first = a.prepare({"id": "claim-one", "amount_base_units": 4000}, wallet)
    second = a.prepare({"id": "claim-two", "amount_base_units": 4000}, wallet)
    assert first["signature"] != second["signature"]
    tx = Transaction.from_bytes(base64.b64decode(first["transaction_b64"]))
    tx.verify()
    assert len(tx.message.instructions) == 3
    assert tx.message.instructions[1].data[0] == 14  # SPL MintToChecked
    assert int.from_bytes(tx.message.instructions[1].data[1:9], "little") == 4000
    assert tx.message.instructions[1].data[9] == 2
    assert tx.message.instructions[2].data == b"LoopMint reward:claim-one"


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
