import hashlib
import secrets
from fastapi import Request, Response, Depends
from .db import transaction
from .config import get_settings
from .services.common import now, require
from .services.accounts import account

COOKIE = "loopmint_session"


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def set_session(c, response: Response, user_id):
    token = secrets.token_urlsafe(32)
    c.execute("DELETE FROM sessions WHERE expires_at<=?", (now(),))
    c.execute(
        "INSERT INTO sessions VALUES (?,?,?)", (digest(token), user_id, now() + 86400)
    )
    response.set_cookie(
        COOKIE,
        token,
        httponly=True,
        secure=get_settings().secure_cookies,
        samesite="strict",
        max_age=86400,
        path="/",
    )


def current_user(request: Request):
    token = request.cookies.get(COOKIE, "")
    with transaction(write=False) as c:
        session = c.one(
            "SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?",
            (digest(token), now()),
        )
        user = account(c, session["user_id"]) if session else None
    require(user, "Please sign in to continue.", 401)
    require(
        not user["wallet"].startswith("demo:")
        or (get_settings().app_mode == "demo" and get_settings().demo_accounts_enabled),
        "Demo accounts are disabled. Sign in to your individual account.",
        401,
    )
    return user


def verifier(user=Depends(current_user)):
    require(user["role"] == "verifier", "Center verifier access required.", 403)
    return user


def partner(user=Depends(current_user)):
    require(user["role"] == "funding_partner", "Funding partner access required.", 403)
    return user
