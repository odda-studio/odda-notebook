"""Access-token refresh for connected accounts."""

from datetime import timedelta

from loguru import logger
from pydantic import SecretStr

from open_notebook.domain.integration import IntegrationAccount, utcnow
from open_notebook.integrations.base import ProviderAuthError, StorageProvider

REFRESH_MARGIN = timedelta(seconds=60)


async def get_valid_access_token(
    account: IntegrationAccount, provider: StorageProvider
) -> str:
    """Return a usable access token, refreshing (and persisting) it when it is
    about to expire."""
    expires_at = account.token_expires_at
    if expires_at and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=utcnow().tzinfo)
    needs_refresh = not account.access_token or (
        expires_at is not None and expires_at - utcnow() < REFRESH_MARGIN
    )
    if not needs_refresh:
        assert account.access_token
        return account.access_token.get_secret_value()

    if not account.refresh_token:
        raise ProviderAuthError(
            "Access token expired and no refresh token is stored. Reconnect the account."
        )
    logger.debug(f"Refreshing access token for integration account {account.id}")
    tokens = await provider.refresh(account.refresh_token.get_secret_value())
    account.access_token = SecretStr(tokens.access_token)
    if tokens.refresh_token:
        account.refresh_token = SecretStr(tokens.refresh_token)
    account.token_expires_at = tokens.expires_at
    await account.save()
    return tokens.access_token
