import secrets
from fastapi import APIRouter, Depends
from ..auth import current_user, verifier
from ..config import get_settings
from ..db import transaction
from ..schemas import ClaimInput, Confirmation, TicketInput
from ..services.common import require, now, uid
from ..services.verification import confirm
from ..repositories.claims import get_claim

router = APIRouter(prefix="/claims")


@router.get("")
def listing(user=Depends(current_user)):
    with transaction(write=False) as c:
        if user["role"] == "verifier":
            ids = c.all(
                "SELECT id FROM claims WHERE center_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
                (user["center_id"],),
            )
        else:
            ids = c.all(
                "SELECT id FROM claims WHERE user_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
                (user["id"],),
            )
        return [get_claim(c, row["id"], user) for row in ids]


@router.post("", status_code=201)
def submit(body: ClaimInput, user=Depends(current_user)):
    require(
        user["role"] == "recycler", "Use a recycler account to submit a drop-off.", 403
    )
    require(
        get_settings().app_mode == "demo" or not user["wallet"].startswith("account:"),
        "Link your Solana wallet in My account before creating a Devnet ticket.",
    )
    with transaction() as c:
        require(
            c.one("SELECT id FROM centers WHERE id=?", (body.center_id,)),
            "Center not found.",
            404,
        )
        claim_id = uid()
        c.execute(
            "INSERT INTO claims VALUES (?,?,?,'submitted',?,?,?)",
            (
                claim_id,
                user["id"],
                body.center_id,
                secrets.token_urlsafe(24),
                now() + get_settings().ticket_ttl_seconds,
                now(),
            ),
        )
        for item in body.items:
            c.execute(
                "INSERT INTO claim_items (claim_id,material,submitted_quantity) VALUES (?,?,?)",
                (claim_id, item.material, item.quantity),
            )
        return get_claim(c, claim_id, user)


@router.post("/ticket")
def open_ticket(body: TicketInput, user=Depends(verifier)):
    with transaction() as c:
        claim = c.one("SELECT * FROM claims WHERE ticket=?", (body.ticket,))
        require(claim, "Ticket not found.", 404)
        require(
            claim["center_id"] == user["center_id"] and claim["user_id"] != user["id"],
            "This ticket cannot be verified by your account.",
            403,
        )
        require(
            claim["status"] in ("submitted", "awaiting_review"),
            "Ticket already used. View the recorded decision in the queue.",
            409,
        )
        require(
            claim["ticket_expires_at"] > now(),
            "Ticket expired. Ask the recycler to renew it.",
            409,
        )
        c.execute(
            "UPDATE claims SET status='awaiting_review' WHERE id=?", (claim["id"],)
        )
        return get_claim(c, claim["id"], user)


@router.get("/{claim_id}")
def detail(claim_id: str, user=Depends(current_user)):
    with transaction(write=False) as c:
        return get_claim(c, claim_id, user)


@router.post("/{claim_id}/renew")
def renew(claim_id: str, user=Depends(current_user)):
    with transaction() as c:
        claim = get_claim(c, claim_id, user)
        require(
            claim["user_id"] == user["id"], "Only the recycler can renew a ticket.", 403
        )
        require(
            claim["status"] in ("submitted", "awaiting_review"),
            "A completed claim cannot receive another ticket.",
            409,
        )
        c.execute(
            "UPDATE claims SET ticket=?, ticket_expires_at=?, status='submitted' WHERE id=?",
            (
                secrets.token_urlsafe(24),
                now() + get_settings().ticket_ttl_seconds,
                claim_id,
            ),
        )
        return get_claim(c, claim_id, user)


@router.post("/{claim_id}/confirm")
def confirmation(claim_id: str, body: Confirmation, user=Depends(verifier)):
    with transaction() as c:
        return confirm(c, claim_id, user, body)
