"""Gemini client for the read-only LoopMint Assistant. Never used for claim verification."""

from functools import lru_cache
from google import genai
from ..config import get_settings


@lru_cache
def client():
    settings = get_settings()
    if not settings.gemini_api_key:
        return None
    return genai.Client(api_key=settings.gemini_api_key)
