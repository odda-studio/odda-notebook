"""Website widget keys: per-notebook credentials for the public chat widget.

The key is a bearer secret that ends up in a public web page, so it grants
only what the widget needs (ask questions of ONE notebook) and is stored
hashed, rate limited and optionally restricted to a list of origins.
"""

import hashlib
import hmac
import secrets
from datetime import datetime
from typing import Any, ClassVar, Dict, List, Optional
from urllib.parse import urlsplit

from pydantic import Field, field_validator

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel
from open_notebook.exceptions import InvalidInputError

KEY_PREFIX = "onw_"
KEY_DISPLAY_CHARS = 10  # shown in the UI, e.g. "onw_AbCdEf"


def generate_key() -> str:
    return KEY_PREFIX + secrets.token_urlsafe(24)


def hash_key(key: str) -> str:
    return hashlib.sha256(key.encode("utf-8")).hexdigest()


def normalize_origin(origin: str) -> str:
    """``scheme://host[:port]``, lowercase, no path/query/trailing slash."""
    value = origin.strip().rstrip("/").lower()
    parts = urlsplit(value)
    if (
        parts.scheme not in ("http", "https")
        or not parts.hostname
        or parts.path
        or parts.query
        or parts.fragment
        or parts.username
        or "*" in value
    ):
        raise InvalidInputError(
            f"Invalid origin '{origin}': use scheme://host[:port], e.g. https://www.example.com"
        )
    return f"{parts.scheme}://{parts.netloc}"


def normalize_origins(origins: List[str]) -> List[str]:
    normalized: List[str] = []
    for origin in origins:
        if origin.strip():
            value = normalize_origin(origin)
            if value not in normalized:
                normalized.append(value)
    return normalized


class WidgetKey(ObjectModel):
    table_name: ClassVar[str] = "widget_key"
    nullable_fields: ClassVar[set[str]] = {"last_used_at"}

    notebook: str
    name: str
    key_hash: str
    key_prefix: str
    enabled: bool = True
    allowed_origins: List[str] = Field(default_factory=list)
    rate_limit_per_minute: int = 20
    daily_limit: int = 0
    last_used_at: Optional[datetime] = None

    @field_validator("notebook", mode="before")
    @classmethod
    def _stringify_notebook(cls, value):
        return str(value) if value is not None else value

    @field_validator("last_used_at", mode="before")
    @classmethod
    def _parse_last_used(cls, value):
        if isinstance(value, str) and value:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        return value

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        data["notebook"] = ensure_record_id(self.notebook)
        return data

    def origin_allowed(self, origin: Optional[str]) -> bool:
        if not self.allowed_origins:
            return True
        return bool(origin) and origin.strip().rstrip("/").lower() in self.allowed_origins  # type: ignore[union-attr]

    @classmethod
    async def find_by_key(cls, key: str) -> Optional["WidgetKey"]:
        if not key.startswith(KEY_PREFIX) or len(key) > 128:
            return None
        digest = hash_key(key)
        rows = await repo_query(
            "SELECT * FROM widget_key WHERE key_hash = $hash LIMIT 1", {"hash": digest}
        )
        if not rows or not hmac.compare_digest(rows[0]["key_hash"], digest):
            return None
        return cls(**rows[0])

    @classmethod
    async def list_for_notebook(cls, notebook_id: str) -> List["WidgetKey"]:
        rows = await repo_query(
            "SELECT * FROM widget_key WHERE notebook = $nb ORDER BY created ASC",
            {"nb": ensure_record_id(notebook_id)},
        )
        return [cls(**row) for row in rows]

    @classmethod
    async def create_for_notebook(
        cls,
        notebook_id: str,
        name: str,
        allowed_origins: List[str],
        rate_limit_per_minute: int,
        daily_limit: int,
    ) -> tuple["WidgetKey", str]:
        """Create a key; returns it together with the one-time plaintext key."""
        key = generate_key()
        widget_key = cls(
            notebook=notebook_id,
            name=name,
            key_hash=hash_key(key),
            key_prefix=key[:KEY_DISPLAY_CHARS],
            allowed_origins=normalize_origins(allowed_origins),
            rate_limit_per_minute=rate_limit_per_minute,
            daily_limit=daily_limit,
        )
        await widget_key.save()
        return widget_key, key

    async def regenerate(self) -> str:
        key = generate_key()
        self.key_hash = hash_key(key)
        self.key_prefix = key[:KEY_DISPLAY_CHARS]
        await self.save()
        return key
