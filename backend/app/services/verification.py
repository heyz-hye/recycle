from .common import require, now, event
from .rewards import create_reward
from ..repositories.claims import get_claim


def confirm(c, claim_id, user, data):
    require(
        user["role"] == "verifier",
        "Only authorized center staff can confirm intake.",
        403,
    )
    claim = get_claim(c, claim_id, user)
    require(
        claim["user_id"] != user["id"], "You cannot verify your own recycling.", 403
    )
    require(claim["center_id"] == user["center_id"], "Wrong recycling center.", 403)
    if claim["status"] in ("verified", "rejected"):
        require(
            claim["verification"]["decision"] == data.decision,
            "This claim already has a final decision.",
            409,
        )
        accepted = {
            i["material"]: i["accepted_quantity"]
            for i in claim["items"]
            if i["accepted_quantity"]
        }
        require(
            accepted == {i.material: i.quantity for i in data.items},
            "This claim was already confirmed with different quantities.",
            409,
        )
        return claim
    require(
        claim["status"] == "awaiting_review",
        "Open the drop-off ticket before confirming intake.",
        409,
    )
    require(
        claim["ticket_expires_at"] > now(),
        "Ticket expired. Ask the recycler to renew it.",
        409,
    )
    submitted = {i["material"] for i in claim["items"]}
    require(
        all(i.material in submitted for i in data.items),
        "Accepted materials must be on the submitted claim.",
    )
    amount = 0
    c.execute(
        "UPDATE claim_items SET accepted_quantity=0 WHERE claim_id=?", (claim_id,)
    )
    for item in data.items:
        rate = c.one("SELECT * FROM reward_rules WHERE material=?", (item.material,))
        # Rates give exact integer units for the two MVP materials (2 base units/gram).
        reward = item.quantity * rate["rate_base_units"] // rate["denominator"]
        amount += reward
        c.execute(
            "UPDATE claim_items SET accepted_quantity=?,rate_base_units=?,rate_denominator=? WHERE claim_id=? AND material=?",
            (
                item.quantity,
                rate["rate_base_units"],
                rate["denominator"],
                claim_id,
                item.material,
            ),
        )
        event(
            c,
            claim["center_id"],
            claim["user_id"],
            item.material,
            item.quantity,
            0,
            "intake",
        )
    c.execute(
        "INSERT INTO verifications VALUES (?,?,?,?,?,?)",
        (
            claim_id,
            user["id"],
            claim["center_id"],
            data.decision,
            data.reason.strip(),
            now(),
        ),
    )
    c.execute(
        "UPDATE claims SET status=? WHERE id=?",
        ("verified" if data.decision == "approved" else "rejected", claim_id),
    )
    if data.decision == "approved":
        require(amount > 0, "Accepted quantities must yield a positive reward.")
        create_reward(c, claim, amount)
    return get_claim(c, claim_id, user)
