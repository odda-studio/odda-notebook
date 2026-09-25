"""
Domain models for cloud-storage sync (Dropbox, Google Drive).

- IntegrationProviderApp: OAuth app credentials entered from the UI
  (environment variables take precedence, see open_notebook.integrations.registry).
- IntegrationAccount: a connected account with its OAuth tokens.
- SyncLink: a remote folder or file imported into 0..N notebooks, synced or not.
- SyncedFile: which remote file produced which source, at which revision,
  and whether that single file is kept in sync.
- IntegrationSettings: global sync settings (singleton record).

Secrets (client secret, access/refresh tokens) are encrypted at rest with the
same Fernet helpers used for AI provider credentials.
"""

from datetime import datetime, timezone
from typing import Any, ClassVar, Dict, List, Literal, Optional

from pydantic import Field, SecretStr, field_validator

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.base import ObjectModel, RecordModel
from open_notebook.utils.encryption import decrypt_value, encrypt_value

ProviderName = Literal["dropbox", "google_drive"]
PROVIDER_NAMES: tuple[str, ...] = ("dropbox", "google_drive")

LinkKind = Literal["folder", "file"]
SyncLinkStatus = Literal["idle", "queued", "running", "error"]
# ignored: the user deleted the source (re-imported only if the file changes)
# excluded: the user excluded the file (never imported again)
SyncedFileStatus = Literal["synced", "unsupported", "error", "ignored", "excluded"]

DEFAULT_ALLOWED_EXTENSIONS: List[str] = [
    # documents
    "pdf", "docx", "doc", "pptx", "xlsx", "xls", "epub", "md", "txt", "html", "htm", "csv",
    # images (OCR, requires Docling)
    "png", "jpg", "jpeg", "tiff", "bmp",
    # audio / video (transcribed with the default speech-to-text model)
    "mp3", "wav", "m4a", "ogg", "flac", "mp4", "avi", "mov", "mkv", "webm",
]  # fmt: skip


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _parse_dt(value: Any) -> Any:
    if isinstance(value, str) and value:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    return value


def _record(value: Optional[str]) -> Any:
    return ensure_record_id(value) if value else value


class _EncryptedModel(ObjectModel):
    """ObjectModel whose `encrypted_fields` are SecretStr in memory and
    Fernet-encrypted strings in the database."""

    encrypted_fields: ClassVar[set[str]] = set()

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        for field in self.__class__.encrypted_fields:
            value = getattr(self, field)
            if isinstance(value, SecretStr):
                data[field] = encrypt_value(value.get_secret_value())
            elif value is not None:
                data[field] = encrypt_value(str(value))
        return data

    async def save(self) -> None:
        originals = {f: getattr(self, f) for f in self.__class__.encrypted_fields}
        await super().save()
        # super().save() copies the stored (encrypted) values back onto self
        for field, value in originals.items():
            object.__setattr__(self, field, value)

    @classmethod
    def _decrypt(cls, instance):
        for field in cls.encrypted_fields:
            value = getattr(instance, field)
            if value:
                raw = value.get_secret_value() if isinstance(value, SecretStr) else value
                object.__setattr__(instance, field, SecretStr(decrypt_value(raw)))
        return instance

    @classmethod
    async def get(cls, id: str):
        return cls._decrypt(await super().get(id))

    @classmethod
    def from_row(cls, row: Dict[str, Any]):
        return cls._decrypt(cls(**row))


class IntegrationProviderApp(_EncryptedModel):
    table_name: ClassVar[str] = "integration_provider"
    encrypted_fields: ClassVar[set[str]] = {"client_secret"}

    provider: str
    client_id: str
    client_secret: Optional[SecretStr] = None

    @classmethod
    async def get_by_provider(cls, provider: str) -> Optional["IntegrationProviderApp"]:
        rows = await repo_query(
            "SELECT * FROM integration_provider WHERE provider = $provider LIMIT 1",
            {"provider": provider},
        )
        return cls.from_row(rows[0]) if rows else None


class IntegrationAccount(_EncryptedModel):
    table_name: ClassVar[str] = "integration_account"
    encrypted_fields: ClassVar[set[str]] = {"access_token", "refresh_token"}
    nullable_fields: ClassVar[set[str]] = {"token_expires_at"}

    provider: str
    name: str
    account_email: Optional[str] = None
    external_account_id: Optional[str] = None
    access_token: Optional[SecretStr] = None
    refresh_token: Optional[SecretStr] = None
    token_expires_at: Optional[datetime] = None
    scopes: Optional[str] = None

    @field_validator("token_expires_at", mode="before")
    @classmethod
    def _parse_expiry(cls, value):
        return _parse_dt(value)

    @classmethod
    async def list_all(cls) -> List["IntegrationAccount"]:
        rows = await repo_query("SELECT * FROM integration_account ORDER BY created ASC")
        return [cls.from_row(row) for row in rows]

    @classmethod
    async def find_by_external_id(
        cls, provider: str, external_account_id: str
    ) -> Optional["IntegrationAccount"]:
        rows = await repo_query(
            "SELECT * FROM integration_account WHERE provider = $provider "
            "AND external_account_id = $external_id LIMIT 1",
            {"provider": provider, "external_id": external_account_id},
        )
        return cls.from_row(rows[0]) if rows else None


class SyncLink(ObjectModel):
    """A remote folder or file imported into 0..N notebooks (none = general
    sources). With `sync_enabled` off it is a one-time copy that remembers its
    origin: the scheduler skips it, "sync now" still refreshes it."""

    table_name: ClassVar[str] = "sync_link"
    nullable_fields: ClassVar[set[str]] = {"last_error", "command"}

    account: str
    kind: LinkKind = "folder"
    remote_id: str
    remote_path: str
    name: str
    web_url: Optional[str] = None
    notebooks: List[str] = Field(default_factory=list)
    recursive: bool = True
    interval_minutes: int = 15
    transformations: List[str] = Field(default_factory=list)
    sync_enabled: bool = True
    status: SyncLinkStatus = "idle"
    last_sync_at: Optional[datetime] = None
    next_sync_at: Optional[datetime] = None
    status_changed_at: Optional[datetime] = None
    last_error: Optional[str] = None
    command: Optional[str] = None

    @field_validator("last_sync_at", "next_sync_at", "status_changed_at", mode="before")
    @classmethod
    def _parse_dates(cls, value):
        return _parse_dt(value)

    @field_validator("account", "command", mode="before")
    @classmethod
    def _stringify_record(cls, value):
        return str(value) if value is not None else value

    @field_validator("transformations", "notebooks", mode="before")
    @classmethod
    def _stringify_records(cls, value):
        return [str(v) for v in value] if value else []

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        data["account"] = _record(self.account)
        data["notebooks"] = [ensure_record_id(n) for n in self.notebooks]
        data["transformations"] = [ensure_record_id(t) for t in self.transformations]
        if self.command:
            data["command"] = _record(self.command)
        return data

    @classmethod
    async def find(cls, account_id: str, remote_id: str) -> Optional["SyncLink"]:
        rows = await repo_query(
            "SELECT * FROM sync_link WHERE account = $account AND remote_id = $remote_id LIMIT 1",
            {"account": ensure_record_id(account_id), "remote_id": remote_id},
        )
        return cls(**rows[0]) if rows else None


class SyncedFile(ObjectModel):
    table_name: ClassVar[str] = "synced_file"
    nullable_fields: ClassVar[set[str]] = {"source", "last_error"}

    link: str
    remote_id: str
    source: Optional[str] = None
    name: str
    remote_path: Optional[str] = None
    web_url: Optional[str] = None
    remote_revision: Optional[str] = None
    content_hash: Optional[str] = None
    remote_modified_at: Optional[datetime] = None
    sync_enabled: bool = True
    status: SyncedFileStatus = "synced"
    last_error: Optional[str] = None

    @field_validator("remote_modified_at", mode="before")
    @classmethod
    def _parse_modified(cls, value):
        return _parse_dt(value)

    @field_validator("link", "source", mode="before")
    @classmethod
    def _stringify_record(cls, value):
        return str(value) if value is not None else value

    def _prepare_save_data(self) -> Dict[str, Any]:
        data = super()._prepare_save_data()
        data["link"] = _record(self.link)
        data["source"] = _record(self.source)
        return data

    @classmethod
    async def list_for_link(cls, link_id: str) -> List["SyncedFile"]:
        rows = await repo_query(
            "SELECT * FROM synced_file WHERE link = $link ORDER BY name ASC",
            {"link": ensure_record_id(link_id)},
        )
        return [cls(**row) for row in rows]

    @classmethod
    async def find_by_source(cls, source_id: str) -> Optional["SyncedFile"]:
        rows = await repo_query(
            "SELECT * FROM synced_file WHERE source = $source LIMIT 1",
            {"source": ensure_record_id(source_id)},
        )
        return cls(**rows[0]) if rows else None


GoogleDocumentFormat = Literal["docx", "pdf", "md", "txt"]
GoogleSpreadsheetFormat = Literal["xlsx", "csv", "pdf"]
GooglePresentationFormat = Literal["pptx", "pdf"]


class IntegrationSettings(RecordModel):
    record_id: ClassVar[str] = "open_notebook:integration_settings"

    public_url: Optional[str] = None
    scheduler_enabled: bool = True
    default_interval_minutes: int = 15
    max_file_mb: int = 100
    allowed_extensions: List[str] = Field(
        default_factory=lambda: list(DEFAULT_ALLOWED_EXTENSIONS)
    )
    google_export_formats: Dict[str, str] = Field(
        default_factory=lambda: {
            "document": "docx",
            "spreadsheet": "xlsx",
            "presentation": "pptx",
        }
    )

    @classmethod
    async def load_fresh(cls) -> "IntegrationSettings":
        """Read the settings from the database, bypassing the per-process
        singleton cache: they are written by the API and read by the worker
        and the scheduler, which run in other processes."""
        cls.clear_instance()
        instance = await cls.get_instance()
        return instance  # type: ignore[return-value]

    def is_eligible(self, extension: str, size: Optional[int]) -> bool:
        allowed = {e.lower().lstrip(".") for e in self.allowed_extensions}
        if extension.lower().lstrip(".") not in allowed:
            return False
        if size is not None and size > self.max_file_mb * 1024 * 1024:
            return False
        return True
