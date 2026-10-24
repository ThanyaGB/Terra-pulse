"""Typed settings from the environment (T0.3). Missing required settings fail fast with a clear message.
Secrets come from the environment / a secret manager, never from the repo. `.env` is git-ignored."""
from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="VAYU_", env_file=".env", extra="ignore")

    env: Literal["dev", "staging", "production"] = "dev"
    jwt_secret: str = Field(default="", description="HS256 signing key; required outside dev")
    token_ttl_s: int = 8 * 3600

    data_mode: Literal["live", "offline"] = "live"    # live: FIRMS + Open-Meteo (+ Sentinel-2 if live_ndvi); offline: recorded fixtures
    live_ndvi: bool = False                            # reading Sentinel-2 COGs takes ~1 min; recorded NDVI is used otherwise
    refresh_minutes: int = 15
    raw_store_dir: str = "var/raw"
    photo_dir: str = "var/photos"
    audio_cache_dir: str = "var/audio"                # Bhashini output cache (SHA-256 of the script)
    audio_library_dir: str = "assets/audio"           # pre-recorded clips: <lang>/<sha256>.wav and prompts/<lang>/<name>.wav
    bhashini_url: str | None = None
    bhashini_api_key: str | None = None
    outbox_path: str = "var/outbox.sqlite"

    redis_url: str | None = None
    database_url: str | None = None
    data_gov_in_key: str | None = None
    cors_origins: str = "http://localhost:5173,http://localhost:5174,http://localhost:4173"

    feature_overrides_path: str | None = "var/feature_overrides.json"   # persists admin flag changes; defaults come from config/features.yaml
    telephony_primary: Literal["twilio", "exotel"] = "exotel"   # ADR-13
    exotel_sid: str | None = None
    exotel_api_key: str | None = None
    exotel_api_token: str | None = None
    exotel_caller_id: str | None = None
    twilio_account_sid: str | None = None
    twilio_auth_token: str | None = None
    twilio_from_number: str | None = None
    call_rate_limit: int = 2
    call_rate_window_s: int = 24 * 3600

    @model_validator(mode="after")
    def _check(self) -> "Settings":
        if not self.jwt_secret:
            if self.env == "dev":
                self.jwt_secret = DEV_SECRET
            else:
                raise ValueError("VAYU_JWT_SECRET is required when VAYU_ENV is not 'dev'. Provide it from the secret manager.")
        if self.env == "production" and self.jwt_secret == DEV_SECRET:
            raise ValueError("refusing to start in production with the development JWT secret")
        return self

    @property
    def cors_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
