"""
Stateless OAuth `state` parameter: an HMAC-signed, expiring payload.

The OAuth callback is reached by a browser redirect that carries no API
password, so it is excluded from the auth middleware. The signed state is what
proves the flow was started by an authenticated user of this instance.
"""

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Optional

from open_notebook.exceptions import ConfigurationError, InvalidInputError
from open_notebook.utils.encryption import get_secret_from_env

STATE_TTL_SECONDS = 600


def _signing_key() -> bytes:
    key = get_secret_from_env("OPEN_NOTEBOOK_ENCRYPTION_KEY")
    if not key:
        raise ConfigurationError(
            "OPEN_NOTEBOOK_ENCRYPTION_KEY must be set to connect cloud storage accounts."
        )
    return hashlib.sha256(f"oauth-state:{key}".encode()).digest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign_state(provider: str, now: Optional[float] = None) -> str:
    issued = now if now is not None else time.time()
    payload = _b64(
        json.dumps(
            {"p": provider, "exp": int(issued + STATE_TTL_SECONDS), "n": secrets.token_urlsafe(8)}
        ).encode()
    )
    signature = _b64(hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest())
    return f"{payload}.{signature}"


def verify_state(state: str, provider: str, now: Optional[float] = None) -> None:
    """Raise InvalidInputError unless `state` is authentic, unexpired and for `provider`."""
    try:
        payload, signature = state.split(".", 1)
    except (AttributeError, ValueError):
        raise InvalidInputError("Invalid OAuth state")
    expected = _b64(hmac.new(_signing_key(), payload.encode(), hashlib.sha256).digest())
    if not hmac.compare_digest(expected, signature):
        raise InvalidInputError("Invalid OAuth state")
    try:
        data = json.loads(_unb64(payload))
    except ValueError:
        raise InvalidInputError("Invalid OAuth state")
    if data.get("p") != provider:
        raise InvalidInputError("OAuth state does not match provider")
    if int(data.get("exp", 0)) < (now if now is not None else time.time()):
        raise InvalidInputError("OAuth state expired, please try connecting again")
