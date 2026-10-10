import logging
import httpx
from fastapi import APIRouter, Depends, HTTPException
from google.genai import errors as genai_errors
from ..auth import current_user
from ..config import get_settings
from ..db import transaction
from ..schemas import ChatInput
from ..services import assistant
from ..services.common import now, require, uid

router = APIRouter()

RATE_LIMIT = 20
WINDOW_SECONDS = 3600

TIMED_OUT = "That took too long to answer. Please try again."
BUSY = "The assistant is busy right now. Please try again in a minute."
UNAVAILABLE = "The assistant is temporarily unavailable. Please try again in a moment."


def failure(exc):
    """A friendly (status, message) for a failed Gemini request; never the upstream text."""
    if isinstance(exc, (httpx.TimeoutException, assistant.AssistantTimeout)):
        return 504, TIMED_OUT
    if isinstance(exc, genai_errors.APIError):
        if exc.code == 504:
            return 504, TIMED_OUT
        if exc.code in (429, 503):
            return 503, BUSY
    return 503, UNAVAILABLE


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
            return assistant.chat(c, user, body.message, body.history)
        except Exception as exc:
            logging.getLogger(__name__).exception("LoopMint Assistant request failed")
            status, message = failure(exc)
        raise HTTPException(status, message)
