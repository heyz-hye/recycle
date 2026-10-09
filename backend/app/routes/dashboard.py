from fastapi import APIRouter, Depends
from ..auth import current_user, partner
from ..db import transaction
from ..config import get_settings
from ..schemas import FundingInput, RedemptionInput, RedemptionConfirm
from ..services.common import now, require
from ..services.rewards import deposit
from ..services import redemptions

router = APIRouter()


@router.get("/maps/config")
def maps_config(user=Depends(current_user)):
    cfg = get_settings()
    # This is a referrer-restricted browser key, never a server credential.
    return {"api_key": cfg.google_maps_browser_key, "map_id": cfg.google_maps_map_id}


@router.get("/centers")
def centers(user=Depends(current_user)):
    with transaction(write=False) as c:
        return c.all(
            "SELECT c.*, l.latitude, l.longitude, COALESCE(l.is_demo,0) AS is_demo, g.google_place_id "
            "FROM centers c LEFT JOIN center_locations l ON l.center_id=c.id "
            "LEFT JOIN center_google_places g ON g.center_id=c.id ORDER BY c.name"
        )


@router.get("/impact")
def impact(user=Depends(current_user)):
    with transaction(write=False) as c:
        totals = c.one(
            "SELECT COALESCE(SUM(CASE WHEN material='bottles' AND event_type='intake' THEN quantity ELSE 0 END),0) AS bottles, COALESCE(SUM(CASE WHEN material='cardboard' AND event_type='intake' THEN quantity ELSE 0 END),0) AS cardboard_grams, COALESCE(SUM(reward_base_units),0) AS reward_base_units FROM recycling_events"
        )
        totals["dropoffs"] = c.one(
            "SELECT COUNT(*) AS n FROM claims WHERE status='verified'"
        )["n"]
        totals["participants"] = c.one(
            "SELECT COUNT(DISTINCT user_id) AS n FROM claims WHERE status='verified'"
        )["n"]
        totals["centers"] = c.all(
            "SELECT z.id,z.name,COUNT(c.id) AS dropoffs FROM centers z LEFT JOIN claims c ON c.center_id=z.id AND c.status='verified' GROUP BY z.id,z.name"
        )
        totals["daily"] = c.all(
            "SELECT CAST(created_at / 86400 AS BIGINT) AS day, SUM(CASE WHEN material='bottles' THEN quantity ELSE 0 END) AS bottles, SUM(CASE WHEN material='cardboard' THEN quantity ELSE 0 END) AS cardboard_grams FROM recycling_events WHERE event_type='intake' AND created_at>=? GROUP BY CAST(created_at / 86400 AS BIGINT) ORDER BY day",
            ((now() // 86400 - 6) * 86400,),
        )
        if get_settings().timescale_enabled:
            totals["daily"] = c.all(
                "SELECT CAST(hour / 86400 AS BIGINT) AS day, SUM(CASE WHEN material='bottles' THEN quantity ELSE 0 END) AS bottles, SUM(CASE WHEN material='cardboard' THEN quantity ELSE 0 END) AS cardboard_grams FROM recycling_hourly WHERE event_type='intake' AND hour>=? GROUP BY CAST(hour / 86400 AS BIGINT) ORDER BY day",
                ((now() // 86400 - 6) * 86400,),
            )
        return totals


@router.get("/wallet")
def wallet(user=Depends(current_user)):
    with transaction(write=False) as c:
        totals = c.one(
            "SELECT COALESCE(SUM(CASE WHEN i.material='bottles' THEN i.accepted_quantity ELSE 0 END),0) AS bottles, "
            "COALESCE(SUM(CASE WHEN i.material='cardboard' THEN i.accepted_quantity ELSE 0 END),0) AS cardboard_grams "
            "FROM claim_items i JOIN claims c ON c.id=i.claim_id WHERE c.user_id=? AND c.status='verified'",
            (user["id"],),
        )
        totals["reward_base_units"] = c.one(
            "SELECT COALESCE(SUM(amount_base_units),0) AS n FROM rewards WHERE user_id=? AND state='confirmed'",
            (user["id"],),
        )["n"]
        return {
            "totals": totals,
            "balance_base_units": redemptions.balance(c, user["id"]),
            "pending_base_units": c.one(
                "SELECT COALESCE(SUM(amount_base_units),0) AS n FROM rewards WHERE user_id=? AND state!='confirmed'",
                (user["id"],),
            )["n"],
            "rewards": c.all(
                "SELECT * FROM rewards WHERE user_id=? ORDER BY created_at DESC",
                (user["id"],),
            ),
            "redemptions": c.all(
                "SELECT * FROM redemptions WHERE user_id=? ORDER BY created_at DESC",
                (user["id"],),
            ),
        }


@router.get("/funding")
def funding(user=Depends(partner)):
    with transaction(write=False) as c:
        result = c.one("SELECT * FROM funding_account WHERE id='main'")
        result["ledger"] = c.all(
            "SELECT * FROM funding_ledger ORDER BY created_at DESC,id DESC LIMIT 100"
        )
        result["awaiting_funding"] = c.one(
            "SELECT COUNT(*) AS n FROM rewards WHERE state='awaiting_funding'"
        )["n"]
        return result


@router.post("/funding")
def add_funding(body: FundingInput, user=Depends(partner)):
    with transaction() as c:
        deposit(c, user, body)
    return funding(user)


@router.post("/redemptions", status_code=201)
def redeem(body: RedemptionInput, user=Depends(current_user)):
    require(user["role"] == "recycler", "Use your recycler wallet to redeem.", 403)
    with transaction() as c:
        return redemptions.create(c, user, body)


@router.post("/redemptions/{redemption_id}/confirm")
def confirm_redemption(
    redemption_id: str, body: RedemptionConfirm, user=Depends(current_user)
):
    return redemptions.confirm(user, redemption_id, body.signature)
