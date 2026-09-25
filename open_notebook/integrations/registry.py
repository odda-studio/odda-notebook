"""
Connector registry and configuration resolution.

OAuth app credentials and the public URL can be set from the UI (stored in the
database) or through environment variables. Environment variables win, so an
operator can pin them in deployment config; the UI then shows them read-only.
"""

import os
from dataclasses import dataclass
from typing import Dict, Literal, Optional, Tuple, Type

from open_notebook.domain.integration import (
    PROVIDER_NAMES,
    IntegrationProviderApp,
    IntegrationSettings,
)
from open_notebook.exceptions import ConfigurationError, InvalidInputError
from open_notebook.integrations.base import StorageProvider
from open_notebook.integrations.dropbox import DropboxProvider
from open_notebook.integrations.google_drive import GoogleDriveProvider
from open_notebook.utils.encryption import get_secret_from_env

ConfigSource = Literal["env", "db"]

PROVIDER_CLASSES: Dict[str, Type[StorageProvider]] = {
    "dropbox": DropboxProvider,
    "google_drive": GoogleDriveProvider,
}

# provider -> (client id env var, client secret env var)
PROVIDER_ENV_VARS: Dict[str, Tuple[str, str]] = {
    "dropbox": ("DROPBOX_APP_KEY", "DROPBOX_APP_SECRET"),
    "google_drive": ("GOOGLE_OAUTH_CLIENT_ID", "GOOGLE_OAUTH_CLIENT_SECRET"),
}

PUBLIC_URL_ENV = "OPEN_NOTEBOOK_PUBLIC_URL"


@dataclass
class AppConfig:
    client_id: Optional[str]
    client_secret: Optional[str]
    source: Optional[ConfigSource]

    @property
    def configured(self) -> bool:
        return bool(self.client_id and self.client_secret)


def validate_provider_name(provider: str) -> str:
    if provider not in PROVIDER_NAMES:
        raise InvalidInputError(f"Unknown integration provider: {provider}")
    return provider


def provider_class(provider: str) -> Type[StorageProvider]:
    return PROVIDER_CLASSES[validate_provider_name(provider)]


def env_app_config(provider: str) -> Optional[AppConfig]:
    id_var, secret_var = PROVIDER_ENV_VARS[validate_provider_name(provider)]
    client_id = (os.environ.get(id_var) or "").strip()
    client_secret = get_secret_from_env(secret_var)
    if client_id or client_secret:
        return AppConfig(client_id or None, client_secret or None, "env")
    return None


async def resolve_app_config(provider: str) -> AppConfig:
    env_config = env_app_config(provider)
    if env_config:
        return env_config
    app = await IntegrationProviderApp.get_by_provider(provider)
    if app:
        secret = app.client_secret.get_secret_value() if app.client_secret else None
        return AppConfig(app.client_id, secret, "db")
    return AppConfig(None, None, None)


def normalize_public_url(url: Optional[str]) -> Optional[str]:
    if not url:
        return None
    url = url.strip().rstrip("/")
    if not url:
        return None
    if not (url.startswith("http://") or url.startswith("https://")):
        raise InvalidInputError("Public URL must start with http:// or https://")
    return url


def resolve_public_url(settings: IntegrationSettings) -> Tuple[Optional[str], Optional[ConfigSource]]:
    env_url = normalize_public_url(os.environ.get(PUBLIC_URL_ENV))
    if env_url:
        return env_url, "env"
    db_url = normalize_public_url(settings.public_url)
    return (db_url, "db") if db_url else (None, None)


def redirect_uri(public_url: Optional[str], provider: str) -> Optional[str]:
    if not public_url:
        return None
    return f"{public_url}/api/integrations/providers/{provider}/callback"


async def get_provider(provider: str) -> StorageProvider:
    config = await resolve_app_config(provider)
    if not config.configured:
        raise ConfigurationError(
            f"{provider_class(provider).display_name} app credentials are not configured. "
            "Set them in Settings → Integrations."
        )
    assert config.client_id and config.client_secret
    return provider_class(provider)(config.client_id, config.client_secret)
