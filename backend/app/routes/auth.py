import secrets
from fastapi import APIRouter, Response, Request, Depends
from solders.pubkey import Pubkey
from solders.signature import Signature
from ..auth import current_user, set_session, COOKIE, digest
from ..config import get_settings
from ..db import transaction
from ..schemas import (
    DemoLogin,
    WalletChallenge,
    WalletLogin,
    Registration,
    EmailLogin,
    PasswordChange,
)
from ..services.common import require, now, uid
from ..services.accounts import (
    account,
    create_account,
    hash_password,
    verify_password,
    throttle,
    clear_email_attempts,
)

router = APIRouter(prefix="/auth")


@router.post("/register", status_code=201)
def register(body: Registration, request: Request, response: Response):
    throttle(body.email, request.client.host if request.client else "unknown")
    hashed = hash_password(body.password)
    with transaction() as c:
        user = create_account(c, body, hashed)
        set_session(c, response, user["id"])
    return user


@router.post("/login")
def email_login(body: EmailLogin, request: Request, response: Response):
    throttle(body.email, request.client.host if request.client else "unknown")
    with transaction(write=False) as c:
        credentials = c.one(
            "SELECT * FROM account_credentials WHERE email=?", (body.email,)
        )
    valid = verify_password(
        body.password, credentials["password_hash"] if credentials else None
    )
    require(credentials and valid, "Email or password is incorrect.", 401)
    with transaction() as c:
        # Reject a password that was reset while the expensive check was running.
        current = c.one(
            "SELECT password_hash FROM account_credentials WHERE user_id=?",
            (credentials["user_id"],),
        )
        require(
            current and current["password_hash"] == credentials["password_hash"],
            "Email or password is incorrect.",
            401,
        )
        user = account(c, credentials["user_id"])
        clear_email_attempts(c, body.email)
        set_session(c, response, user["id"])
    return user


@router.post("/password")
def change_password(
    body: PasswordChange,
    request: Request,
    response: Response,
    user=Depends(current_user),
):
    require(user["email"], "This account uses wallet sign-in.", 400)
    throttle(user["email"], request.client.host if request.client else "unknown")
    with transaction(write=False) as c:
        credentials = c.one(
            "SELECT password_hash FROM account_credentials WHERE user_id=?",
            (user["id"],),
        )
    require(
        verify_password(body.current_password, credentials["password_hash"]),
        "Current password is incorrect.",
        401,
    )
    hashed = hash_password(body.new_password)
    with transaction() as c:
        current = c.one(
            "SELECT password_hash FROM account_credentials WHERE user_id=?",
            (user["id"],),
        )
        require(
            current["password_hash"] == credentials["password_hash"],
            "Password changed. Please sign in again.",
            409,
        )
        c.execute(
            "UPDATE account_credentials SET password_hash=?,password_changed_at=? WHERE user_id=?",
            (hashed, now(), user["id"]),
        )
        c.execute("DELETE FROM sessions WHERE user_id=?", (user["id"],))
        clear_email_attempts(c, user["email"])
        set_session(c, response, user["id"])
    return {"ok": True}


@router.get("/me")
def me(user=Depends(current_user)):
    return user


@router.post("/demo")
def demo(body: DemoLogin, response: Response):
    require(
        get_settings().app_mode == "demo" and get_settings().demo_accounts_enabled,
        "Demo accounts are disabled.",
        404,
    )
    with transaction() as c:
        user = account(c, body.account)
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


def consume_wallet_challenge(c, body):
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
    return entry["wallet"]


@router.post("/verify")
def login(body: WalletLogin, response: Response):
    with transaction() as c:
        wallet = consume_wallet_challenge(c, body)
        user = c.one("SELECT * FROM users WHERE wallet=?", (wallet,))
        if not user:
            user = dict(
                id=uid(),
                wallet=wallet,
                username=body.username.strip() or "Recycler",
                role="recycler",
                center_id=None,
            )
            c.execute("INSERT INTO users VALUES (?,?,?,?,?)", tuple(user.values()))
        set_session(c, response, user["id"])
        return account(c, user["id"])


@router.post("/link-wallet")
def link_wallet(body: WalletLogin, user=Depends(current_user)):
    require(user["email"], "Use wallet sign-in for this account.")
    with transaction() as c:
        wallet = consume_wallet_challenge(c, body)
        owner = c.one("SELECT id FROM users WHERE wallet=?", (wallet,))
        require(
            not owner or owner["id"] == user["id"],
            "This wallet belongs to another account.",
            409,
        )
        current = c.one("SELECT wallet FROM users WHERE id=?", (user["id"],))
        require(
            current["wallet"].startswith("account:") or current["wallet"] == wallet,
            "A wallet is already linked. Contact your operator to change it.",
            409,
        )
        c.execute("UPDATE users SET wallet=? WHERE id=?", (wallet, user["id"]))
        return account(c, user["id"])


@router.post("/logout")
def logout(request: Request, response: Response):
    with transaction() as c:
        c.execute(
            "DELETE FROM sessions WHERE token_hash=?",
            (digest(request.cookies.get(COOKIE, "")),),
        )
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}
