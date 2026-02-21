from __future__ import annotations

import json
import logging
from abc import ABC, abstractmethod
from datetime import datetime, timedelta, timezone
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

from app.core.config import Settings

logger = logging.getLogger(__name__)

SchemaT = TypeVar("SchemaT", bound=BaseModel)


class LLMError(RuntimeError):
    pass


class LLMRateLimitError(LLMError):
    pass


class BaseLLMClient(ABC):
    @abstractmethod
    async def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[SchemaT],
        retries: int = 2,
    ) -> SchemaT:
        raise NotImplementedError

    async def close(self) -> None:
        return None


class OpenAIClient(BaseLLMClient):
    def __init__(
        self,
        api_key: str,
        model: str,
        timeout_seconds: int = 45,
        rate_limit_cooldown_seconds: int = 30,
    ) -> None:
        if not api_key:
            raise LLMError("LLM_API_KEY is required for OpenAI provider")
        self._api_key = api_key
        self._model = model
        self._client = httpx.AsyncClient(timeout=timeout_seconds)
        self._rate_limit_until: datetime | None = None
        self._default_rate_limit_cooldown_seconds = max(1, rate_limit_cooldown_seconds)

    async def close(self) -> None:
        await self._client.aclose()

    async def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[SchemaT],
        retries: int = 2,
    ) -> SchemaT:
        self._raise_if_rate_limited()
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt},
        ]

        last_exception: Exception | None = None
        for attempt in range(retries + 1):
            try:
                raw_content = await self._request(messages)
                parsed = json.loads(raw_content)
                return schema.model_validate(parsed)
            except (json.JSONDecodeError, ValidationError) as exc:
                last_exception = exc
                logger.warning("LLM JSON validation failed on attempt %s/%s", attempt + 1, retries + 1)
                messages.append(
                    {
                        "role": "system",
                        "content": (
                            "Your previous response failed schema validation. "
                            "Return ONLY valid JSON that matches the required schema exactly."
                        ),
                    }
                )
            except LLMRateLimitError as exc:
                last_exception = exc
                logger.warning("LLM rate limited on attempt %s/%s", attempt + 1, retries + 1)
                break
            except Exception as exc:  # noqa: BLE001
                last_exception = exc
                logger.warning("LLM request failed on attempt %s/%s", attempt + 1, retries + 1)

        raise LLMError(f"Failed to generate valid structured JSON: {last_exception}")

    async def _request(self, messages: list[dict[str, str]]) -> str:
        response: httpx.Response
        try:
            response = await self._client.post(
                "https://api.openai.com/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {self._api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": self._model,
                    "messages": messages,
                    "temperature": 0,
                    "response_format": {"type": "json_object"},
                },
            )
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            if exc.response.status_code == 429:
                self._mark_rate_limited(exc.response)
                raise LLMRateLimitError(str(exc)) from exc
            raise

        payload = response.json()
        choices = payload.get("choices") or []
        if not choices:
            raise LLMError("No choices returned from LLM")

        message = choices[0].get("message") or {}
        content = message.get("content")
        if isinstance(content, list):
            text_parts = [part.get("text", "") for part in content if isinstance(part, dict)]
            return "".join(text_parts)
        if isinstance(content, str):
            return content
        raise LLMError("Unexpected LLM response content format")

    def _raise_if_rate_limited(self) -> None:
        if self._rate_limit_until is None:
            return
        now = datetime.now(timezone.utc)
        if now >= self._rate_limit_until:
            self._rate_limit_until = None
            return
        remaining = int((self._rate_limit_until - now).total_seconds()) + 1
        raise LLMRateLimitError(f"LLM rate limited. Cooldown active for ~{remaining}s.")

    def _mark_rate_limited(self, response: httpx.Response) -> None:
        retry_after_header = response.headers.get("retry-after", "")
        cooldown_seconds = self._default_rate_limit_cooldown_seconds
        try:
            parsed = int(float(retry_after_header))
            if parsed > 0:
                cooldown_seconds = parsed
        except (TypeError, ValueError):
            pass
        self._rate_limit_until = datetime.now(timezone.utc) + timedelta(seconds=cooldown_seconds)


class MockLLMClient(BaseLLMClient):
    async def generate_json(
        self,
        *,
        system_prompt: str,
        user_prompt: str,
        schema: type[SchemaT],
        retries: int = 2,
    ) -> SchemaT:
        del system_prompt, user_prompt, retries

        if "soap" in schema.model_fields:
            return schema.model_validate(
                {
                    "soap": {
                        "subjective": ["Patient-reported symptoms discussed in conversation."],
                        "objective": [],
                        "assessment": ["Working diagnosis pending clinician confirmation."],
                        "plan": ["Continue history-taking and complete physical exam."],
                    },
                    "citations": [],
                }
            )

        if "risks" in schema.model_fields:
            return schema.model_validate({"risks": []})

        return schema.model_validate({})


def build_llm_client(settings: Settings) -> BaseLLMClient:
    provider = settings.llm_provider.strip().lower()
    if provider == "openai":
        try:
            return OpenAIClient(
                api_key=settings.llm_api_key,
                model=settings.llm_model,
                timeout_seconds=settings.llm_timeout_seconds,
                rate_limit_cooldown_seconds=settings.llm_rate_limit_cooldown_seconds,
            )
        except LLMError as exc:
            logger.warning("Falling back to mock LLM client: %s", exc)
            return MockLLMClient()

    logger.warning("Unsupported LLM_PROVIDER=%s. Falling back to mock provider.", settings.llm_provider)
    return MockLLMClient()
