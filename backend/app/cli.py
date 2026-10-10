"""Operator-only commands; roles are never assigned by a browser request."""

import argparse
from pathlib import Path
from solders.pubkey import Pubkey
from .config import get_settings
from .db import initialize, transaction
from .services.common import uid
from .schemas import CenterConfiguration
from .services.centers import configure_center


def main():
    parser = argparse.ArgumentParser(description="LoopMint administration")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init", help="Initialize schema and center policies")
    sub.add_parser(
        "create-devnet-mint",
        help="Create a 2-decimal SPL mint using the configured funded Devnet issuer",
    )
    role = sub.add_parser(
        "grant-role", help="Provision a trusted wallet and invalidate its sessions"
    )
    role.add_argument("--wallet", required=True)
    role.add_argument("--username", required=True)
    role.add_argument(
        "--role", choices=["recycler", "verifier", "funding_partner"], required=True
    )
    role.add_argument("--center", default=None)
    center = sub.add_parser(
        "configure-center",
        help="Register or update a participating center and its verified coordinates",
    )
    center.add_argument("--id", required=True)
    center.add_argument("--name", required=True)
    center.add_argument("--address", required=True)
    center.add_argument("--latitude", required=True, type=float)
    center.add_argument("--longitude", required=True, type=float)
    sub.add_parser(
        "enable-timescale",
        help="Create the event hypertable and hourly continuous aggregate",
    )
    args = parser.parse_args()
    get_settings().validate_runtime()
    initialize()
    if args.command == "configure-center":
        from pydantic import ValidationError

        try:
            data = CenterConfiguration(
                **{
                    key: getattr(args, key)
                    for key in ("id", "name", "address", "latitude", "longitude")
                }
            )
        except ValidationError as exc:
            parser.error(str(exc))
        with transaction() as c:
            configure_center(c, data)
        print(
            "Center registered. Assign its staff wallet with grant-role --center "
            + data.id
        )
    elif args.command == "create-devnet-mint":
        import json
        from solana.rpc.api import Client
        from solders.keypair import Keypair
        from spl.token.client import Token
        from spl.token.constants import TOKEN_PROGRAM_ID

        cfg = get_settings()
        if cfg.app_mode != "devnet" or not cfg.solana_issuer_keypair:
            parser.error("Set APP_MODE=devnet and SOLANA_ISSUER_KEYPAIR first")
        rpc = Client(cfg.solana_rpc_url, commitment="confirmed")
        if (
            str(rpc.get_genesis_hash().value)
            != "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
        ):
            parser.error("Only Solana Devnet is supported")
        issuer = Keypair.from_bytes(
            bytes(json.loads(Path(cfg.solana_issuer_keypair).read_text()))
        )
        token = Token.create_mint(rpc, issuer, issuer.pubkey(), 2, TOKEN_PROGRAM_ID)
        print(f"Devnet mint created. Set SOLANA_MINT={token.pubkey}")
    elif args.command == "grant-role":
        Pubkey.from_string(args.wallet)
        if args.role == "verifier" and not args.center:
            parser.error("--center is required for a verifier")
        with transaction() as c:
            if args.center and not c.one(
                "SELECT id FROM centers WHERE id=?", (args.center,)
            ):
                parser.error("Unknown center")
            c.execute(
                "INSERT INTO users VALUES (?,?,?,?,?) ON CONFLICT(wallet) DO UPDATE SET username=excluded.username,role=excluded.role,center_id=excluded.center_id",
                (uid(), args.wallet, args.username, args.role, args.center),
            )
            user = c.one("SELECT id FROM users WHERE wallet=?", (args.wallet,))
            c.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        print("Role provisioned. Sign in again to use it.")
    elif args.command == "enable-timescale":
        if not get_settings().database_url.startswith("postgres"):
            parser.error("TimescaleDB requires PostgreSQL")
        with transaction() as c:
            # Execute as a script: function bodies contain semicolons.
            c.raw.execute((Path(__file__).parents[1] / "sql/timescale.sql").read_text())
        print("Timescale analytics installed. Set TIMESCALE_ENABLED=true for the API.")
    else:
        print("Database initialized.")


if __name__ == "__main__":
    main()
