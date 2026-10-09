import hashlib
import secrets
from fastapi import Request, Response, Depends
from .db import transaction
from .config import get_settings
from .services.common import now, require

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
        user = c.one(
            "SELECT u.* FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=? AND s.expires_at>?",
            (digest(token), now()),
        )
    require(user, "Please sign in to continue.", 401)
    return user


def verifier(user=Depends(current_user)):
    require(user["role"] == "verifier", "Center verifier access required.", 403)
    return user


def partner(user=Depends(current_user)):
    require(user["role"] == "funding_partner", "Funding partner access required.", 403)
    return user
