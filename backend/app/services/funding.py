"""Verified USDC receipts. Deposits are funding, not user wallet credits."""

from ..config import get_settings
from .common import now, require


def record_deposit(c, actor_id, signature):
    from .solana_client import chain
    from .rewards import fund_waiting

    require(
        get_settings().app_mode == "devnet", "USDC deposits require Devnet mode.", 409
    )
    existing = c.one("SELECT * FROM funding_deposits WHERE signature=?", (signature,))
    if existing:
        return existing
    try:
        receipt = chain().verify_usdc_deposit(signature)
    except ValueError as exc:
        require(False, str(exc), 409)
    except Exception:
        require(
            False, "Unable to verify the deposit on Devnet. Try again shortly.", 503
        )
    c.execute(
        "INSERT INTO funding_deposits (signature,amount_base_units,treasury,mint,slot,actor_id,created_at) VALUES (?,?,?,?,?,?,?)",
        (
            signature,
            receipt["amount_base_units"],
            receipt["treasury"],
            receipt["mint"],
            receipt["slot"],
            actor_id,
            now(),
        ),
    )
    fund_waiting(c)
    return c.one("SELECT * FROM funding_deposits WHERE signature=?", (signature,))


def summary(c):
    from .assets import total, remaining_fund, fund_snapshot
    from .solana_client import chain

    result = {
        "received_usdc_base_units": total(
            c, "SELECT SUM(amount_base_units) AS n FROM funding_deposits"
        ),
        "remaining_usdc_base_units": remaining_fund(c),
        "converted_usd_micros": total(
            c, "SELECT SUM(usd_micros) AS n FROM conversions"
        ),
        "distributed_loop_base_units": fund_snapshot(c)["supply_base_units"],
        "deposits": c.all(
            "SELECT * FROM funding_deposits ORDER BY created_at DESC,signature LIMIT 100"
        ),
        "usdc_mint": get_settings().solana_usdc_mint,
        "treasury_address": None,
    }
    try:
        result["treasury_address"] = str(chain().issuer.pubkey())
    except Exception:
        pass
    return result
