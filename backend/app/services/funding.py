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
        require(
            existing["mint"] == get_settings().solana_usdc_mint,
            "This receipt belongs to a different funding token.",
            409,
        )
        require(
            actor_id is None
            or not c.one(
                "SELECT signature FROM funding_inventory_receipts WHERE signature=?",
                (signature,),
            ),
            "This receipt is test inventory, not released government funding.",
            409,
        )
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
    if actor_id is None:
        # Operator setup stock is not a government release. Keep its receipt
        # for auditing without increasing LOOP backing or queuing rewards.
        c.execute(
            "INSERT INTO funding_inventory_receipts VALUES (?,?,?)",
            (
                signature,
                "Operator test inventory; not released government funding",
                now(),
            ),
        )
    else:
        fund_waiting(c)
    return c.one("SELECT * FROM funding_deposits WHERE signature=?", (signature,))


def summary(c):
    from .assets import total, remaining_fund, outstanding_loop
    from .solana_client import chain

    result = {
        "received_usdc_base_units": total(
            c,
            "SELECT SUM(d.amount_base_units) AS n FROM funding_deposits d WHERE d.mint=? AND NOT EXISTS (SELECT 1 FROM funding_inventory_receipts i WHERE i.signature=d.signature)",
            (get_settings().solana_usdc_mint,),
        ),
        "inventory_usdc_base_units": total(
            c,
            "SELECT SUM(d.amount_base_units) AS n FROM funding_deposits d JOIN funding_inventory_receipts i ON i.signature=d.signature WHERE d.mint=?",
            (get_settings().solana_usdc_mint,),
        ),
        "remaining_usdc_base_units": remaining_fund(c),
        "converted_usd_micros": total(
            c,
            "SELECT SUM(v.usd_micros) AS n FROM conversions v JOIN conversion_quote_mints m ON m.quote_id=v.quote_id WHERE m.mint=?",
            (get_settings().solana_usdc_mint,),
        ),
        "distributed_loop_base_units": outstanding_loop(c),
        "deposits": c.all(
            "SELECT d.*, CASE WHEN i.signature IS NULL THEN 0 ELSE 1 END AS is_inventory FROM funding_deposits d LEFT JOIN funding_inventory_receipts i ON i.signature=d.signature WHERE d.mint=? ORDER BY d.created_at DESC,d.signature LIMIT 100",
            (get_settings().solana_usdc_mint,),
        ),
        "mock_usdc": get_settings().mock_usdc_enabled,
        "usdc_mint": get_settings().solana_usdc_mint,
        "treasury_address": None,
    }
    try:
        result["treasury_address"] = str(chain().issuer.pubkey())
    except Exception:
        pass
    return result
