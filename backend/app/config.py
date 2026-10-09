from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict
from typing import Literal
from urllib.parse import urlsplit, parse_qs


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_mode: Literal["demo", "devnet"] = "demo"
    database_url: str = "sqlite:///.data/loopmint.db"
    public_origin: str = "http://localhost:3000"
    secure_cookies: bool = False
    demo_auto_worker: bool = True
    demo_accounts_enabled: bool = True
    timescale_enabled: bool = False
    google_maps_browser_key: str = ""
    google_maps_map_id: str = "DEMO_MAP_ID"
    ticket_ttl_seconds: int = 1800
    solana_rpc_url: str = "https://api.devnet.solana.com"
    solana_mint: str = ""
    solana_issuer_keypair: str = ""
    token_decimals: int = 2

    def validate_runtime(self):
        parsed = urlsplit(self.database_url)
        if parsed.hostname and parsed.hostname.endswith(
            (".tigerdata.com", ".timescale.com")
        ):
            if parse_qs(parsed.query).get("sslmode", [""])[0] not in (
                "require",
                "verify-ca",
                "verify-full",
            ):
                raise ValueError(
                    "Tiger Data connections require sslmode=require or stronger in DATABASE_URL."
                )
        if self.token_decimals != 2:
            raise ValueError(
                "The MVP uses two token decimals; configure the mint accordingly."
            )
        if self.app_mode == "devnet" and not self.database_url.startswith("postgres"):
            raise ValueError("Devnet mode requires PostgreSQL.")


@lru_cache
def get_settings():
    return Settings()
