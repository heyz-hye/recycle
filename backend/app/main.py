import asyncio
import contextlib
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from .config import get_settings
from .db import initialize
from .routes import auth, claims, dashboard, chat


async def demo_worker():
    from .worker import tick

    while True:
        await asyncio.sleep(2)
        try:
            await asyncio.to_thread(tick)
        except Exception:
            logging.getLogger(__name__).exception("Demo worker cycle failed")


@asynccontextmanager
async def lifespan(app):
    config = get_settings()
    config.validate_runtime()
    initialize()
    task = (
        asyncio.create_task(demo_worker())
        if config.app_mode == "demo" and config.demo_auto_worker
        else None
    )
    yield
    if task:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task


app = FastAPI(title="LoopMint", version="0.1.0", lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    # Pydantic's default errors include rejected inputs, which may contain passwords.
    return JSONResponse(
        status_code=422,
        content={
            "detail": [
                {"loc": error["loc"], "msg": error["msg"], "type": error["type"]}
                for error in exc.errors()
            ]
        },
    )


@app.middleware("http")
async def secure_requests(request: Request, call_next):
    if request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        allowed = {get_settings().public_origin.rstrip("/")}
        if get_settings().app_mode == "demo":
            allowed |= {"http://localhost:3000", "http://127.0.0.1:3000"}
        if origin and origin.rstrip("/") not in allowed:
            return JSONResponse(
                {"detail": "Request origin is not allowed."}, status_code=403
            )
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["X-Content-Type-Options"] = "nosniff"
    return response


@app.get("/api/health")
def health():
    return {
        "ok": True,
        "mode": get_settings().app_mode,
        "demo_accounts_enabled": get_settings().app_mode == "demo"
        and get_settings().demo_accounts_enabled,
        "network": "simulated"
        if get_settings().app_mode == "demo"
        else "solana:devnet",
    }


for router in (auth.router, claims.router, dashboard.router, chat.router):
    app.include_router(router, prefix="/api")
