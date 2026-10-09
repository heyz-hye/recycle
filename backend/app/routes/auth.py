import secrets
from fastapi import APIRouter, Response, Request, Depends
from solders.pubkey import Pubkey
from solders.signature import Signature
from ..auth import current_user, set_session, COOKIE, digest
from ..config import get_settings
from ..db import transaction
from ..schemas import DemoLogin, WalletChallenge, WalletLogin
from ..services.common import require, now, uid

router = APIRouter(prefix="/auth")


@router.get("/me")
def me(user=Depends(current_user)):
    return user


@router.post("/demo")
def demo(body: DemoLogin, response: Response):
    require(get_settings().app_mode == "demo", "Demo accounts are disabled.", 404)
    with transaction() as c:
        user = c.one("SELECT * FROM users WHERE id=?", (body.account,))
        set_session(c, response, user["id"])
    return user


@router.post("/challenge")
def challenge(body: WalletChallenge):
    try:
        Pubkey.from_string(body.wallet)
    except ValueError:
        require(False, "Invalid Solana wallet address.")
    with transaction() as c:
        c.execute("DELETE FROM challenges WHERE expires_at<=?", (now(),))
        count = c.one(
            "SELECT COUNT(*) AS n FROM challenges WHERE wallet=?", (body.wallet,)
        )["n"]
        require(count < 10, "Too many login attempts. Try again in five minutes.", 429)
        challenge_id = uid()
        message = f"LoopMint wallet sign-in\nOrigin: {get_settings().public_origin}\nWallet: {body.wallet}\nNonce: {secrets.token_urlsafe(24)}\nExpires: {now() + 300}\nThis signature signs you in. It does not send tokens."
        c.execute(
            "INSERT INTO challenges VALUES (?,?,?,?)",
            (challenge_id, body.wallet, message, now() + 300),
        )
    return {"challenge_id": challenge_id, "message": message}


@router.post("/verify")
def login(body: WalletLogin, response: Response):
    with transaction() as c:
        entry = c.one("SELECT * FROM challenges WHERE id=?", (body.challenge_id,))
        require(
            entry and entry["expires_at"] > now(),
            "Login request expired or already used.",
            401,
        )
        try:
            valid = Signature.from_string(body.signature).verify(
                Pubkey.from_string(entry["wallet"]), entry["message"].encode()
            )
        except ValueError:
            valid = False
        require(valid, "Wallet signature could not be verified.", 401)
        c.execute("DELETE FROM challenges WHERE id=?", (body.challenge_id,))
        user = c.one("SELECT * FROM users WHERE wallet=?", (entry["wallet"],))
        if not user:
            user = dict(
                id=uid(),
                wallet=entry["wallet"],
                username=body.username.strip() or "Recycler",
                role="recycler",
                center_id=None,
            )
            c.execute("INSERT INTO users VALUES (?,?,?,?,?)", tuple(user.values()))
        set_session(c, response, user["id"])
    return user


@router.post("/logout")
def logout(request: Request, response: Response):
    with transaction() as c:
        c.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            (digest(request.cookies.get(COOKIE, "")),),
        )
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
