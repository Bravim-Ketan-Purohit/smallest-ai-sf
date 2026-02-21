from __future__ import annotations

from functools import lru_cache
from typing import Annotated

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, NoDecode, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    smallest_api_key: str = Field(default="", alias="SMALLEST_API_KEY")
    llm_provider: str = Field(default="openai", alias="LLM_PROVIDER")
    llm_api_key: str = Field(default="", alias="LLM_API_KEY")
    llm_model: str = Field(default="gpt-4o-mini", alias="LLM_MODEL")
    app_env: str = Field(default="dev", alias="APP_ENV")
    allowed_origins: Annotated[list[str], NoDecode] = Field(
        default_factory=lambda: ["http://localhost:3000"],
        alias="ALLOWED_ORIGINS",
    )

    smallest_language: str = Field(default="en", alias="SMALLEST_LANGUAGE")
    smallest_sample_rate: int = Field(default=16000, alias="SMALLEST_SAMPLE_RATE")
    smallest_encoding: str = Field(default="linear16", alias="SMALLEST_ENCODING")

    llm_timeout_seconds: int = 45
    llm_retry_count: int = 2
    llm_rate_limit_cooldown_seconds: int = Field(default=30, alias="LLM_RATE_LIMIT_COOLDOWN_SECONDS")

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def parse_allowed_origins(cls, value: str | list[str] | None) -> list[str]:
        if isinstance(value, list):
            return value
        if not value:
            return ["http://localhost:3000"]
        return [origin.strip() for origin in value.split(",") if origin.strip()]


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
