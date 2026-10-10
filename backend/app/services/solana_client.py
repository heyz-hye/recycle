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
from solders.system_program import transfer, TransferParams
from spl.token.constants import TOKEN_PROGRAM_ID
from spl.token.instructions import (
    create_idempotent_associated_token_account,
    get_associated_token_address,
    burn_checked,
    BurnCheckedParams,
    transfer_checked,
    TransferCheckedParams,
)
from spl.token.client import Token
from ..config import get_settings


class DemoChain:
    prefix = "demo"

    def __init__(self, prefix="demo"):
        self.prefix = prefix

    def prepare(self, reward, wallet):
        signature = f"{self.prefix}:{reward['id']}"
        return {
            "transaction_b64": base64.b64encode(signature.encode()).decode(),
            "signature": signature,
            "last_valid_block_height": 0,
        }

    def status(self, job):
        return "confirmed" if job["attempts"] else "missing"

    def broadcast(self, transaction_b64):
        return None

    def prepare_withdrawal(self, row):
        return self.prepare({"id": "withdrawal:" + row["id"]}, row["destination"])


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
        if not 2 <= info.decimals <= 9:
            raise RuntimeError("LOOP requires a classic SPL mint with 2 to 9 decimals.")
        self.loop_decimals = info.decimals

    def loop_chain_units(self, amount):
        return amount * 10 ** (getattr(self, "loop_decimals", 2) - 2)

    def loop_supply(self):
        info = Token(self.rpc, self.mint, TOKEN_PROGRAM_ID, self.issuer).get_mint_info()
        return info.supply // 10 ** (info.decimals - 2)

    def prepare(self, reward, wallet):
        # Legacy external reward jobs also transfer existing treasury stock.
        # New rewards credit the platform first and use manual withdrawals.
        return self.prepare_withdrawal(
            {
                "id": f"reward:{reward['id']}",
                "asset": "LOOP",
                "amount_base_units": reward["amount_base_units"],
                "destination": wallet,
            }
        )

    def usdc_mint(self):
        if (
            get_settings().solana_usdc_mint
            != "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"
        ):
            raise ValueError("Only Circle's Solana Devnet USDC mint is supported.")
        mint = Pubkey.from_string(get_settings().solana_usdc_mint)
        info = Token(self.rpc, mint, TOKEN_PROGRAM_ID, self.issuer).get_mint_info()
        if info.decimals != 6:
            raise ValueError("USDC requires a classic SPL mint with 6 decimals.")
        return mint

    def asset_balance(self, asset):
        if asset == "SOL":
            return max(
                0,
                self.rpc.get_balance(self.issuer.pubkey()).value
                - get_settings().treasury_fee_reserve_lamports,
            )
        if asset == "LOOP":
            account = get_associated_token_address(self.issuer.pubkey(), self.mint)
            units = self.token_account_balance(account)
            return units // 10 ** (self.loop_decimals - 2)
        if asset == "USDC":
            account = get_associated_token_address(
                self.issuer.pubkey(), self.usdc_mint()
            )
            return self.token_account_balance(account)
        raise ValueError("Unsupported treasury asset.")

    def token_account_balance(self, account):
        # A treasury that has never received this token has no associated account.
        # Treat only a confirmed absent account as zero; RPC failures must propagate.
        if self.rpc.get_account_info(account).value is None:
            return 0
        return int(self.rpc.get_token_account_balance(account).value.amount)

    def check_payout(self, asset, amount):
        reserve = get_settings().treasury_fee_reserve_lamports
        if self.rpc.get_balance(self.issuer.pubkey()).value < reserve + (
            amount if asset == "SOL" else 0
        ):
            raise ValueError("Treasury needs Devnet SOL for transfers and fees.")
        if asset in ("LOOP", "USDC") and self.asset_balance(asset) < amount:
            raise ValueError("Treasury needs more tokens of the selected asset.")

    def prepare_withdrawal(self, row):
        self.check_payout(row["asset"], row["amount_base_units"])
        owner = Pubkey.from_string(row["destination"])
        if row["asset"] == "SOL":
            instructions = [
                transfer(
                    TransferParams(
                        from_pubkey=self.issuer.pubkey(),
                        to_pubkey=owner,
                        lamports=row["amount_base_units"],
                    )
                )
            ]
        else:
            is_loop = row["asset"] == "LOOP"
            mint = self.mint if is_loop else self.usdc_mint()
            instructions = [
                create_idempotent_associated_token_account(
                    self.issuer.pubkey(), owner, mint
                ),
                transfer_checked(
                    TransferCheckedParams(
                        program_id=TOKEN_PROGRAM_ID,
                        source=get_associated_token_address(self.issuer.pubkey(), mint),
                        mint=mint,
                        dest=get_associated_token_address(owner, mint),
                        owner=self.issuer.pubkey(),
                        amount=self.loop_chain_units(row["amount_base_units"])
                        if is_loop
                        else row["amount_base_units"],
                        decimals=getattr(self, "loop_decimals", 2) if is_loop else 6,
                    )
                ),
            ]
        instructions.append(
            Instruction(
                Pubkey.from_string("MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr"),
                f"LoopMint withdrawal:{row['id']}".encode(),
                [],
            )
        )
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
