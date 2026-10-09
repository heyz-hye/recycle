"""Devnet-only adapter. Signed issuance is persisted by the worker before broadcast."""

import base64
import json
from functools import lru_cache
from pathlib import Path
from solana.rpc.api import Client
from solana.rpc.types import TxOpts
from solders.keypair import Keypair
from solders.pubkey import Pubkey
from solders.signature import Signature
from solders.transaction import Transaction
from solders.message import Message
from solders.instruction import Instruction
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import (
    create_idempotent_associated_token_account,
    get_associated_token_address,
    mint_to_checked,
    MintToCheckedParams,
    burn_checked,
    BurnCheckedParams,
)
from spl.token.client import Token
from ..config import get_settings


class DemoChain:
    def prepare(self, reward, wallet):
        signature = f"demo:{reward['id']}"
        return {
            "transaction_b64": base64.b64encode(signature.encode()).decode(),
            "signature": signature,
            "last_valid_block_height": 0,
        }

    def status(self, job):
        return "confirmed" if job["attempts"] else "missing"

    def broadcast(self, transaction_b64):
        return None


class SolanaChain:
    def __init__(self):
        cfg = get_settings()
        if not cfg.solana_mint or not cfg.solana_issuer_keypair:
            raise RuntimeError(
                "Configure a Devnet mint and issuer keypair before starting the worker."
            )
        self.rpc = Client(cfg.solana_rpc_url, commitment="confirmed", timeout=15)
        if (
            str(self.rpc.get_genesis_hash().value)
            != "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
        ):
            raise RuntimeError("Only Solana Devnet is supported.")
        self.issuer = Keypair.from_bytes(
            bytes(json.loads(Path(cfg.solana_issuer_keypair).read_text()))
        )
        self.mint = Pubkey.from_string(cfg.solana_mint)
        info = Token(self.rpc, self.mint, TOKEN_PROGRAM_ID, self.issuer).get_mint_info()
        if info.decimals != 2 or info.mint_authority != self.issuer.pubkey():
            raise RuntimeError(
                "Mint must have 2 decimals and the configured issuer as mint authority."
            )

    def prepare(self, reward, wallet):
        owner = Pubkey.from_string(wallet)
        ata = get_associated_token_address(owner, self.mint)
        instructions = [
            create_idempotent_associated_token_account(
                self.issuer.pubkey(), owner, self.mint
            ),
            mint_to_checked(
                MintToCheckedParams(
                    program_id=TOKEN_PROGRAM_ID,
                    mint=self.mint,
                    dest=ata,
                    mint_authority=self.issuer.pubkey(),
                    amount=reward["amount_base_units"],
                    decimals=2,
                )
            ),
            Instruction(
                Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
                f"LoopMint reward:{reward['id']}".encode(),
                [],
            ),
        ]
        block = self.rpc.get_latest_blockhash().value
        tx = Transaction.new_signed_with_payer(
            instructions, self.issuer.pubkey(), [self.issuer], block.blockhash
        )
        return {
            "transaction_b64": base64.b64encode(bytes(tx)).decode(),
            "signature": str(tx.signatures[0]),
            "last_valid_block_height": block.last_valid_block_height,
        }

    def status(self, job):
        status = self.rpc.get_signature_statuses(
            [Signature.from_string(job["signature"])], search_transaction_history=True
        ).value[0]
        if status:
            if status.err:
                return "failed"
            if (
                str(status.confirmation_status)
                .lower()
                .endswith(("confirmed", "finalized"))
            ):
                return "confirmed"
            return "pending"
        if self.rpc.get_block_height().value > job["last_valid_block_height"]:
            return "expired"
        return "missing"

    def broadcast(self, transaction_b64):
        self.rpc.send_raw_transaction(
            base64.b64decode(transaction_b64),
            opts=TxOpts(
                skip_confirmation=True,
                skip_preflight=False,
                preflight_commitment="confirmed",
            ),
        )

    def prepare_burn(self, wallet, amount, redemption_id):
        owner = Pubkey.from_string(wallet)
        ix = burn_checked(
            BurnCheckedParams(
                program_id=TOKEN_PROGRAM_ID,
                account=get_associated_token_address(owner, self.mint),
                mint=self.mint,
                owner=owner,
                amount=amount,
                decimals=2,
            )
        )
        block = self.rpc.get_latest_blockhash().value
        tx = Transaction.new_unsigned(
            Message.new_with_blockhash(
                [
                    ix,
                    Instruction(
                        Pubkey.from_string(
                            "MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"
                        ),
                        f"LoopMint redemption:{redemption_id}".encode(),
                        [],
                    ),
                ],
                owner,
                block.blockhash,
            )
        )
        return base64.b64encode(bytes(tx)).decode()

    def verify_burn(self, signature, expected_b64):
        response = self.rpc.get_transaction(
            Signature.from_string(signature),
            encoding="base64",
            commitment="confirmed",
            max_supported_transaction_version=0,
        )
        result = json.loads(response.to_json())["result"]
        if result is None:
            return False
        if result["meta"]["err"] is not None:
            raise ValueError("The burn transaction failed.")
        actual = Transaction.from_bytes(base64.b64decode(result["transaction"][0]))
        expected = Transaction.from_bytes(base64.b64decode(expected_b64))
        if (
            bytes(actual.message) != bytes(expected.message)
            or str(actual.signatures[0]) != signature
        ):
            raise ValueError(
                "Transaction does not match the authorized redemption burn."
            )
        actual.verify()
        return True


@lru_cache
def chain():
    return DemoChain() if get_settings().app_mode == "demo" else SolanaChain()
