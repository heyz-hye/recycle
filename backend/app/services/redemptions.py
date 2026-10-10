import logging
from .common import now, uid, require
from .solana_client import chain
from ..config import get_settings
from ..db import transaction


def balance(c, user_id):
    from .assets import balances

    return balances(c, user_id)["LOOP"]["available_base_units"]


def complete(c, row):
    changed = c.execute(
        "UPDATE redemptions SET state='completed' WHERE id=? AND state='pending'",
        (row["id"],),
    ).rowcount
    if changed:
        c.execute(
            "UPDATE funding_account SET redeemed_cents=redeemed_cents+? WHERE id='main'",
            (row["payout_cents"],),
        )
        c.execute(
            "INSERT INTO funding_ledger VALUES (?,?,?,?,?,?)",
            (
                uid(),
                "simulated_payout",
                row["payout_cents"],
                f"redeem:{row['id']}",
                row["user_id"],
                now(),
            ),
        )


def create(c, user, body):
    require(
        get_settings().app_mode == "demo",
        "Use conversion and withdrawal for platform balances. Legacy burns are disabled.",
        409,
    )
    key = f"{user['id']}:{body.request_key}"
    previous = c.one("SELECT * FROM redemptions WHERE request_key=?", (key,))
    if previous:
        require(
            previous["amount_base_units"] == body.amount_base_units,
            "Request key already used for a different amount.",
            409,
        )
        return previous
    require(
        balance(c, user["id"]) >= body.amount_base_units,
        "Insufficient confirmed, uncommitted rewards.",
    )
    redemption_id = uid()
    demo = get_settings().app_mode == "demo"
    raw = (
        None
        if demo
        else chain().prepare_burn(user["wallet"], body.amount_base_units, redemption_id)
    )
    c.execute(
        "INSERT INTO redemptions VALUES (?,?,?,?,'pending',?,?,?,?)",
        (
            redemption_id,
            user["id"],
            body.amount_base_units,
            body.amount_base_units // 100,
            raw,
            f"demo:burn:{redemption_id}" if demo else None,
            key,
            now(),
        ),
    )
    row = c.one("SELECT * FROM redemptions WHERE id=?", (redemption_id,))
    if demo:
        complete(c, row)
        row["state"] = "completed"
    return row


def confirm(user, redemption_id, signature):
    from solders.signature import Signature

    try:
        Signature.from_string(signature)
    except ValueError:
        require(False, "Invalid transaction signature.")
    with transaction() as c:
        row = c.one(
            "SELECT * FROM redemptions WHERE id=? AND user_id=?",
            (redemption_id, user["id"]),
        )
        require(row, "Redemption not found.", 404)
        if row["state"] == "completed":
            require(
                row["signature"] == signature,
                "Redemption already completed with a different transaction.",
                409,
            )
            return row
        # Never associate unrelated or unconfirmed signatures with a pending redemption.
        try:
            verified = chain().verify_burn(signature, row["transaction_b64"])
        except ValueError as exc:
            require(False, str(exc))
        require(
            verified,
            "Burn is not confirmed yet. Retry this same signature shortly.",
            409,
        )
        used = c.one(
            "SELECT id FROM redemptions WHERE signature=? AND id!=?",
            (signature, redemption_id),
        )
        require(not used, "This burn has already been redeemed.", 409)
        c.execute(
            "UPDATE redemptions SET signature=? WHERE id=?", (signature, redemption_id)
        )
        complete(c, row)
        return c.one("SELECT * FROM redemptions WHERE id=?", (redemption_id,))


def reconcile_pending(adapter):
    # Known signatures may be submitted by trusted operational recovery tooling.
    with transaction(write=False) as c:
        pending = c.all(
            "SELECT * FROM redemptions WHERE state='pending' AND signature IS NOT NULL"
        )
    for row in pending:
        try:
            if adapter.verify_burn(row["signature"], row["transaction_b64"]):
                with transaction() as c:
                    complete(c, row)
        except Exception:
            logging.getLogger(__name__).exception(
                "Pending burn needs reconciliation: %s", row["id"]
            )
