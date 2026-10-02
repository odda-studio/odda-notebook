"""
Provider-agnostic interface for cloud-storage connectors.

Connectors are thin httpx clients over each provider's REST API (no vendor
SDKs, see ADR-009). They only know how to authenticate, list and download;
all sync decisions live in open_notebook.integrations.sync.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import ClassVar, Dict, List, Optional, Tuple

import httpx

from open_notebook.exceptions import ExternalServiceError

DEFAULT_TIMEOUT = httpx.Timeout(30.0, read=300.0)

# Browsing-only folders that group items the provider does not place under
# the user's root ("Shared with me", shared drives). They can be opened in the
# picker but not linked themselves.
VIRTUAL_PREFIX = "virtual:"
SHARED_WITH_ME = f"{VIRTUAL_PREFIX}shared-with-me"
SHARED_DRIVES = f"{VIRTUAL_PREFIX}shared-drives"


def is_virtual(item_id: Optional[str]) -> bool:
    return bool(item_id) and str(item_id).startswith(VIRTUAL_PREFIX)


class ProviderError(ExternalServiceError):
    """Transient provider failure (network, 5xx, rate limit): worth retrying."""


class ProviderAuthError(ProviderError):
    """Token revoked/expired beyond refresh, or app credentials rejected."""


class RemoteNotFoundError(ProviderError):
    """The remote folder or file does not exist (or is no longer shared)."""


@dataclass
class TokenSet:
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[datetime] = None
    scopes: Optional[str] = None


@dataclass
class AccountInfo:
    external_id: str
    name: str
    email: Optional[str] = None


@dataclass
class RemoteFolder:
    id: str
    name: str
    path: str
    web_url: Optional[str] = None
    # False for virtual groupings (see VIRTUAL_PREFIX)
    selectable: bool = True


@dataclass
class RemoteFile:
    id: str
    name: str
    path: str
    revision: str
    mime_type: Optional[str] = None
    content_hash: Optional[str] = None
    modified_at: Optional[datetime] = None
    size: Optional[int] = None
    # Set for provider-native documents (e.g. Google Docs) that must be exported
    export_mime: Optional[str] = None
    export_extension: Optional[str] = None
    web_url: Optional[str] = None

    @property
    def local_name(self) -> str:
        """File name to store locally (with the export extension, if any)."""
        if self.export_extension:
            return f"{self.name}.{self.export_extension}"
        return self.name

    @property
    def extension(self) -> str:
        return Path(self.local_name).suffix.lower().lstrip(".")


class StorageProvider(ABC):
    name: ClassVar[str]
    display_name: ClassVar[str]
    console_url: ClassVar[str]
    root_folder_id: ClassVar[str]

    def __init__(
        self,
        client_id: str,
        client_secret: str,
        transport: Optional[httpx.AsyncBaseTransport] = None,
    ):
        self.client_id = client_id
        self.client_secret = client_secret
        self._transport = transport

    def _client(self) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=DEFAULT_TIMEOUT, transport=self._transport)

    @staticmethod
    def _raise_for_status(response: httpx.Response, not_found_markers: tuple = ()) -> None:
        if response.is_success:
            return
        body = response.text[:500]
        if response.status_code == 401:
            raise ProviderAuthError(f"Authorization rejected by provider: {body}")
        if response.status_code == 404 or any(m in body for m in not_found_markers):
            raise RemoteNotFoundError(f"Remote item not found: {body}")
        if response.status_code in (400, 403) and "invalid_grant" in body:
            raise ProviderAuthError(f"Refresh token rejected: {body}")
        raise ProviderError(f"Provider error {response.status_code}: {body}")

    async def _stream_to_file(
        self, request: httpx.Request, dest_path: str, not_found_markers: tuple = ()
    ) -> None:
        async with self._client() as client:
            response = await client.send(request, stream=True)
            try:
                if not response.is_success:
                    await response.aread()
                    self._raise_for_status(response, not_found_markers)
                with open(dest_path, "wb") as f:
                    async for chunk in response.aiter_bytes():
                        f.write(chunk)
            finally:
                await response.aclose()

    def folder_web_url(self, folder_id: str, path: str) -> Optional[str]:
        """Link to open a folder in the provider's web UI."""
        return None

    # --- OAuth -----------------------------------------------------------------

    @abstractmethod
    def authorize_url(self, state: str, redirect_uri: str) -> str: ...

    @abstractmethod
    async def exchange_code(self, code: str, redirect_uri: str) -> TokenSet: ...

    @abstractmethod
    async def refresh(self, refresh_token: str) -> TokenSet: ...

    @abstractmethod
    async def get_account(self, access_token: str) -> AccountInfo: ...

    # --- Browsing / sync -------------------------------------------------------

    @abstractmethod
    async def list_children(
        self, access_token: str, parent_id: Optional[str], export_formats: Dict[str, str]
    ) -> Tuple[str, List[RemoteFolder], List[RemoteFile]]:
        """(path of the parent, its sub-folders, its files) - for the picker."""

    @abstractmethod
    async def search(
        self, access_token: str, query: str, export_formats: Dict[str, str], limit: int
    ) -> Tuple[List[RemoteFolder], List[RemoteFile], bool]:
        """Folders and files whose name matches ``query`` anywhere in the
        account (up to ``limit``), and whether more results were left out."""

    @abstractmethod
    async def get_file(
        self, access_token: str, file_id: str, export_formats: Dict[str, str]
    ) -> Optional[RemoteFile]:
        """A single file, or None if it no longer exists (deleted/trashed)."""

    @abstractmethod
    async def folder_exists(self, access_token: str, folder_id: str) -> bool: ...

    @abstractmethod
    async def list_files(
        self,
        access_token: str,
        folder_id: str,
        recursive: bool,
        export_formats: Dict[str, str],
    ) -> List[RemoteFile]: ...

    @abstractmethod
    async def download(
        self, access_token: str, file: RemoteFile, dest_path: str
    ) -> None: ...
