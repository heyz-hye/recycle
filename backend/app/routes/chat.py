import logging
from fastapi import APIRouter, Depends
from ..auth import current_user
from ..config import get_settings
from ..db import transaction
from ..schemas import ChatInput
from ..services import assistant
from ..services.common import now, require, uid

router = APIRouter()

RATE_LIMIT = 20
WINDOW_SECONDS = 3600


@router.post("/chat")
def send_message(body: ChatInput, user=Depends(current_user)):
    if not get_settings().gemini_api_key:
        return {
            "reply": "The LoopMint Assistant isn't configured yet. Please check back soon.",
            "configured": False,
        }
    with transaction() as c:
        c.execute(
            "DELETE FROM chat_messages WHERE created_at<=?", (now() - WINDOW_SECONDS,)
        )
        count = c.one(
            "SELECT COUNT(*) AS n FROM chat_messages WHERE user_id=? AND created_at>?",
            (user["id"], now() - WINDOW_SECONDS),
        )["n"]
        require(
            count < RATE_LIMIT,
            "You've reached the hourly limit for the assistant. Please try again later.",
            429,
        )
        c.execute(
            "INSERT INTO chat_messages VALUES (?,?,?)", (uid(), user["id"], now())
        )
    with transaction(write=False) as c:
        try:
            return assistant.chat(c, user, body.message)
        except Exception:
            logging.getLogger(__name__).exception("LoopMint Assistant request failed")
            return {
                "reply": "The assistant is temporarily unavailable. Please try again in a moment.",
                "configured": True,
            }
