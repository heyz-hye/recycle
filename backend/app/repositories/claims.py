from ..services.common import require


def get_claim(c, claim_id, user):
    claim = c.one(
        "SELECT c.*, u.username, z.name AS center_name FROM claims c JOIN users u ON u.id=c.user_id JOIN centers z ON z.id=c.center_id WHERE c.id=?",
        (claim_id,),
    )
    require(claim, "Claim not found.", 404)
    allowed = claim["user_id"] == user["id"] or (
        user["role"] == "verifier" and user["center_id"] == claim["center_id"]
    )
    require(allowed, "This claim is not accessible to your account.", 403)
    claim["items"] = c.all(
        "SELECT * FROM claim_items WHERE claim_id=? ORDER BY material", (claim_id,)
    )
    claim["verification"] = c.one(
        "SELECT * FROM verifications WHERE claim_id=?", (claim_id,)
    )
    claim["reward"] = c.one(
        "SELECT r.*, j.last_error, j.needs_review, f.code AS funding_reason, f.message AS funding_message FROM rewards r LEFT JOIN reward_jobs j ON j.reward_id=r.id LEFT JOIN reward_funding_status f ON f.reward_id=r.id WHERE r.claim_id=?",
        (claim_id,),
    )
    return claim
