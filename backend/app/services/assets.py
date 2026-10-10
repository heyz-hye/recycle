"""Platform balances, fund-based quotes, and durable wallet withdrawals.

All balance-changing entry points run under db.transaction's global financial
write lock. Conversion is an atomic treasury exchange, not a DEX swap.
"""

import json
import logging
from decimal import Decimal
from urllib.request import urlopen, Request

from solders.pubkey import Pubkey

from ..config import get_settings
from ..db import transaction
from .common import now, uid, require

log = logging.getLogger(__name__)
DECIMALS = {"LOOP": 2, "USDC": 6, "SOL": 9}


def total(c, sql, params=()):
    return int(c.one(sql, params)["n"] or 0)


def remaining_fund(c):
    budget = c.one(
        "SELECT received_cents,redeemed_cents FROM funding_account WHERE id='main'"
    )
    paid = total(c, "SELECT SUM(usd_micros) AS n FROM conversions")
    if get_settings().app_mode == "devnet":
        mint = get_settings().solana_usdc_mint
        received = total(
            c,
            "SELECT SUM(amount_base_units) AS n FROM funding_deposits WHERE mint=?",
            (mint,),
        )
        paid = total(
            c,
            "SELECT SUM(v.usd_micros) AS n FROM conversions v JOIN conversion_quote_mints m ON m.quote_id=v.quote_id WHERE m.mint=?",
            (mint,),
        )
        return max(0, received - paid)
    return max(0, (budget["received_cents"] - budget["redeemed_cents"]) * 10000 - paid)


def fund_snapshot(c):
    # Staff confirmation earns the reward, including amounts awaiting inventory
    # or settlement. Those obligations must affect price before they are spendable.
    # Wallet withdrawals remain outstanding; unallocated treasury stock is excluded.
    earned = total(
        c,
        "SELECT SUM(r.amount_base_units) AS n FROM rewards r JOIN claims c ON c.id=r.claim_id WHERE c.status='verified'",
    )
    converted = total(c, "SELECT SUM(loop_base_units) AS n FROM conversions")
    burned = total(
        c, "SELECT SUM(amount_base_units) AS n FROM redemptions WHERE state='completed'"
    )
    return {
        "fund_usd_micros": remaining_fund(c),
        "supply_base_units": max(0, earned - converted - burned),
    }


def loop_inventory_available(c):
    from .solana_client import chain

    held = chain().asset_balance("LOOP")
    owed = total(
        c,
        "SELECT SUM(r.amount_base_units) AS n FROM rewards r JOIN reward_custody d ON d.reward_id=r.id WHERE d.delivery='internal' AND r.state IN ('queued','sent','confirmed')",
    )
    converted = total(c, "SELECT SUM(loop_base_units) AS n FROM conversions")
    withdrawn = total(
        c,
        "SELECT SUM(amount_base_units) AS n FROM withdrawals WHERE asset='LOOP' AND state='confirmed'",
    )
    return max(0, held - owed + converted + withdrawn)


def balances(c, user_id):
    fallback = "internal" if get_settings().app_mode == "demo" else "external"
    earned = total(
        c,
        "SELECT SUM(r.amount_base_units) AS n FROM rewards r LEFT JOIN reward_custody d ON d.reward_id=r.id WHERE r.user_id=? AND r.state='confirmed' AND COALESCE(d.delivery,?)='internal'",
        (user_id, fallback),
    )
    # Historical Devnet redemptions burned external tokens, not platform credit.
    burned = (
        total(
            c,
            "SELECT SUM(amount_base_units) AS n FROM redemptions WHERE user_id=?",
            (user_id,),
        )
        if fallback == "internal"
        else 0
    )
    converted = total(
        c,
        "SELECT SUM(loop_base_units) AS n FROM conversions WHERE user_id=?",
        (user_id,),
    )
    result = {}
    for asset in DECIMALS:
        credit = (
            earned - burned - converted
            if asset == "LOOP"
            else total(
                c,
                "SELECT SUM(output_base_units) AS n FROM conversions WHERE user_id=? AND asset=?",
                (user_id, asset),
            )
        )
        spent = total(
            c,
            "SELECT SUM(amount_base_units) AS n FROM withdrawals WHERE user_id=? AND asset=?",
            (user_id, asset),
        )
        pending = total(
            c,
            "SELECT SUM(amount_base_units) AS n FROM withdrawals WHERE user_id=? AND asset=? AND state!='confirmed'",
            (user_id, asset),
        )
        result[asset] = {
            "available_base_units": max(0, credit - spent),
            "pending_base_units": pending,
            "decimals": DECIMALS[asset],
        }
    return result


def overview(c, user_id):
    cfg = get_settings()
    return {
        "balances": balances(c, user_id),
        "valuation": fund_snapshot(c),
        "withdrawals": c.all(
            "SELECT id,asset,amount_base_units,destination,state,signature,last_error,created_at FROM withdrawals WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
            (user_id,),
        ),
        "conversions": c.all(
            "SELECT id,asset,loop_base_units,output_base_units,usd_micros,created_at FROM conversions WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
            (user_id,),
        ),
        "mock_usdc": cfg.mock_usdc_enabled,
        "usdc_mint": cfg.solana_usdc_mint,
        "network": "simulated" if cfg.app_mode == "demo" else "solana:devnet",
        "supply_basis": "earned_unredeemed",
        "withdrawals_configured": cfg.app_mode == "demo"
        or bool(cfg.solana_issuer_keypair and cfg.solana_mint),
    }


def sol_price():
    # Demo prices are explicitly labelled test prices in the quote UI.
    if get_settings().app_mode == "demo":
        return 100000000  # $100/SOL fixture, never used by the Devnet adapter.
    try:
        req = Request(
            "https://api.coinbase.com/v2/prices/SOL-USD/spot",
            headers={"User-Agent": "LoopMint/0.1"},
        )
        with urlopen(req, timeout=5) as response:
            data = json.load(response)["data"]
        price = Decimal(data["amount"])
        require(
            data["currency"] == "USD" and price.is_finite() and 0 < price < 1000000,
            "Invalid SOL price.",
            503,
        )
        return int(price * 1000000)
    except Exception:
        require(False, "SOL pricing is temporarily unavailable. Try again later.", 503)


def treasury_available(c, asset):
    if get_settings().app_mode == "demo":
        return 9000000000000000
    from .solana_client import chain

    try:
        held = chain().asset_balance(asset)
    except Exception:
        require(
            False,
            "The Devnet treasury is not configured or reachable for this asset.",
            503,
        )
    liability = total(
        c, "SELECT SUM(output_base_units) AS n FROM conversions WHERE asset=?", (asset,)
    )
    paid = total(
        c,
        "SELECT SUM(amount_base_units) AS n FROM withdrawals WHERE asset=? AND state='confirmed'",
        (asset,),
    )
    return max(0, held - liability + paid)


def quote(c, user, body):
    require(user["role"] == "recycler", "Use a recycler account to convert LOOP.", 403)
    require(
        balances(c, user["id"])["LOOP"]["available_base_units"] >= body.loop_base_units,
        "Insufficient available LOOP.",
    )
    value = fund_snapshot(c)
    require(
        value["supply_base_units"] > 0 and value["fund_usd_micros"] > 0,
        "No funded LOOP supply is available for conversion.",
    )
    usd = value["fund_usd_micros"] * body.loop_base_units // value["supply_base_units"]
    price = sol_price() if body.asset == "SOL" else 0
    output = usd if body.asset == "USDC" else usd * 1000000000 // price
    require(usd > 0 and output > 0, "Amount is too small to convert.")
    require(output <= 9000000000000000, "Amount is too large to convert.")
    available = treasury_available(c, body.asset)
    decimals = 6 if body.asset == "USDC" else 9
    scale = Decimal(10) ** decimals
    require(
        available >= output,
        f"The Devnet treasury needs {Decimal(output) / scale:f} {body.asset} for this conversion, "
        f"but only {Decimal(available) / scale:f} {body.asset} is available. "
        f"Fund the treasury with Devnet {body.asset}, then try again.",
        409,
    )
    row = dict(
        id=uid(),
        user_id=user["id"],
        loop_base_units=body.loop_base_units,
        asset=body.asset,
        output_base_units=output,
        usd_micros=usd,
        **value,
        sol_usd_micros=price,
        expires_at=now() + 60,
        created_at=now(),
    )
    c.execute(
        "INSERT INTO conversion_quotes VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        tuple(row.values()),
    )
    c.execute(
        "INSERT INTO conversion_quote_mints VALUES (?,?)",
        (row["id"], get_settings().solana_usdc_mint),
    )
    return row


def convert(c, user, body):
    require(user["role"] == "recycler", "Use a recycler account to convert LOOP.", 403)
    key = f"{user['id']}:{body.request_key}"
    previous = c.one("SELECT * FROM conversions WHERE request_key=?", (key,))
    if previous:
        require(
            previous["quote_id"] == body.quote_id,
            "Request key already used for another conversion.",
            409,
        )
        return previous
    q = c.one(
        "SELECT * FROM conversion_quotes WHERE id=? AND user_id=?",
        (body.quote_id, user["id"]),
    )
    require(q, "Quote not found.", 404)
    used = c.one("SELECT * FROM conversions WHERE quote_id=?", (q["id"],))
    if used:
        return used
    if get_settings().app_mode == "devnet":
        scope = c.one(
            "SELECT mint FROM conversion_quote_mints WHERE quote_id=?", (q["id"],)
        )
        require(
            scope and scope["mint"] == get_settings().solana_usdc_mint,
            "Funding token changed. Request a new quote.",
            409,
        )
    require(q["expires_at"] > now(), "Quote expired. Request a new quote.", 409)
    snapshot = fund_snapshot(c)
    require(
        all(snapshot[k] == q[k] for k in snapshot),
        "Fund value or LOOP supply changed. Request a new quote.",
        409,
    )
    require(
        balances(c, user["id"])["LOOP"]["available_base_units"] >= q["loop_base_units"],
        "Insufficient available LOOP.",
        409,
    )
    require(
        treasury_available(c, q["asset"]) >= q["output_base_units"],
        "Treasury liquidity changed. Request a new quote later.",
        409,
    )
    identity = uid()
    c.execute(
        "INSERT INTO conversions VALUES (?,?,?,?,?,?,?,?,?)",
        (
            identity,
            q["id"],
            user["id"],
            key,
            q["loop_base_units"],
            q["asset"],
            q["output_base_units"],
            q["usd_micros"],
            now(),
        ),
    )
    return c.one("SELECT * FROM conversions WHERE id=?", (identity,))


def withdraw(c, user, body):
    require(user["role"] == "recycler", "Use a recycler account to withdraw.", 403)
    key = f"{user['id']}:{body.request_key}"
    previous = c.one("SELECT * FROM withdrawals WHERE request_key=?", (key,))
    if previous:
        require(
            (previous["asset"], previous["amount_base_units"], previous["destination"])
            == (body.asset, body.amount_base_units, body.destination),
            "Request key already used for another withdrawal.",
            409,
        )
        return public_withdrawal(previous)
    wallet = c.one("SELECT wallet FROM users WHERE id=?", (user["id"],))["wallet"]
    try:
        valid = Pubkey.from_string(wallet).is_on_curve()
    except ValueError:
        valid = False
    require(valid, "Link your Solana wallet in My account before withdrawing.")
    require(
        wallet == body.destination,
        "Withdrawal destination must match your linked wallet.",
        409,
    )
    require(
        balances(c, user["id"])[body.asset]["available_base_units"]
        >= body.amount_base_units,
        "Insufficient available balance.",
        409,
    )
    if get_settings().app_mode != "demo":
        from .solana_client import chain

        try:
            chain().check_payout(body.asset, body.amount_base_units)
        except Exception:
            require(
                False,
                "The Devnet treasury needs configuration or funds before this withdrawal can be queued.",
                503,
            )
    identity = uid()
    c.execute(
        "INSERT INTO withdrawals (id,user_id,asset,amount_base_units,destination,state,request_key,created_at) VALUES (?,?,?,?,?,'queued',?,?)",
        (identity, user["id"], body.asset, body.amount_base_units, wallet, key, now()),
    )
    return public_withdrawal(c.one("SELECT * FROM withdrawals WHERE id=?", (identity,)))


def public_withdrawal(row):
    return {
        k: row[k]
        for k in (
            "id",
            "asset",
            "amount_base_units",
            "destination",
            "state",
            "signature",
            "last_error",
            "created_at",
        )
    }


def process_withdrawals(adapter=None):
    with transaction(write=False) as c:
        ids = c.all(
            "SELECT id FROM withdrawals WHERE state IN ('queued','sent') ORDER BY created_at,id LIMIT 20"
        )
    if not ids:
        return
    from .solana_client import chain

    adapter = adapter or chain()
    for item in ids:
        try:
            with transaction() as c:
                row = c.one("SELECT * FROM withdrawals WHERE id=?", (item["id"],))
                if row["state"] not in ("queued", "sent"):
                    continue
                if not row["signature"]:
                    prepared = adapter.prepare_withdrawal(row)
                    c.execute(
                        "UPDATE withdrawals SET transaction_b64=?,signature=?,last_valid_block_height=? WHERE id=?",
                        (
                            prepared["transaction_b64"],
                            prepared["signature"],
                            prepared["last_valid_block_height"],
                            row["id"],
                        ),
                    )
                    row.update(prepared)
            # Persist the exact signed bytes BEFORE any broadcast. Never re-sign
            # an uncertain withdrawal; retries reconcile this same signature.
            state = adapter.status(row)
            if state == "confirmed":
                with transaction() as c:
                    c.execute(
                        "UPDATE withdrawals SET state='confirmed',confirmed_at=?,last_error=NULL WHERE id=? AND state IN ('queued','sent')",
                        (now(), row["id"]),
                    )
            elif state in ("failed", "expired"):
                with transaction() as c:
                    c.execute(
                        "UPDATE withdrawals SET state='review',last_error=? WHERE id=? AND state IN ('queued','sent')",
                        (
                            "Operator review required. Funds remain reserved; no replacement transfer is sent.",
                            row["id"],
                        ),
                    )
            elif state == "missing":
                adapter.broadcast(row["transaction_b64"])
                with transaction() as c:
                    c.execute(
                        "UPDATE withdrawals SET state='sent',attempts=attempts+1,last_error=NULL WHERE id=? AND state IN ('queued','sent')",
                        (row["id"],),
                    )
        except Exception:
            log.exception("Withdrawal processing failed: %s", item["id"])
            with transaction() as c:
                c.execute(
                    "UPDATE withdrawals SET last_error=? WHERE id=? AND state IN ('queued','sent')",
                    (
                        "Transfer pending. We will reconcile the same transaction before retrying.",
                        item["id"],
                    ),
                )
