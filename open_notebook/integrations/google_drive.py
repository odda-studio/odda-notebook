"""Google Drive connector (Drive API v3, OAuth2 with offline access).

Google-native documents (Docs, Sheets, Slides) have no binary content and are
exported to the format chosen in the integration settings.
"""

from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlencode

import httpx

from open_notebook.integrations.base import (
    SHARED_DRIVES,
    SHARED_WITH_ME,
    AccountInfo,
    RemoteFile,
    RemoteFolder,
    RemoteNotFoundError,
    StorageProvider,
    TokenSet,
)

AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
API_URL = "https://www.googleapis.com/drive/v3"
SCOPE = "https://www.googleapis.com/auth/drive.readonly"

FOLDER_MIME = "application/vnd.google-apps.folder"
NATIVE_PREFIX = "application/vnd.google-apps."

# native kind -> {extension: export mime type}
EXPORT_MIME_TYPES: Dict[str, Dict[str, str]] = {
    "document": {
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "pdf": "application/pdf",
        "md": "text/markdown",
        "txt": "text/plain",
    },
    "spreadsheet": {
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "csv": "text/csv",
        "pdf": "application/pdf",
    },
    "presentation": {
        "pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "pdf": "application/pdf",
    },
}
DEFAULT_EXPORT = {"document": "docx", "spreadsheet": "xlsx", "presentation": "pptx"}

FILE_FIELDS = "id,name,mimeType,md5Checksum,version,modifiedTime,size,trashed,webViewLink"
MAX_PATH_DEPTH = 50


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _escape(value: str) -> str:
    return value.replace("\\", "\\\\").replace("'", "\\'")


def _export_for(mime_type: str, export_formats: Dict[str, str]) -> Optional[Tuple[str, str]]:
    """(extension, export mime) for an exportable native type, else None."""
    kind = mime_type[len(NATIVE_PREFIX):]
    options = EXPORT_MIME_TYPES.get(kind)
    if not options:
        return None
    extension = export_formats.get(kind) or DEFAULT_EXPORT[kind]
    if extension not in options:
        extension = DEFAULT_EXPORT[kind]
    return extension, options[extension]


def _folder_url(folder_id: str) -> str:
    return f"https://drive.google.com/drive/folders/{folder_id}"


def _to_remote(
    item: Dict[str, Any], path: str, export_formats: Dict[str, str]
) -> Optional[RemoteFile]:
    """RemoteFile for a Drive file item, or None if there is nothing to import."""
    mime = item.get("mimeType", "")
    export_ext: Optional[str] = None
    export_mime: Optional[str] = None
    if mime == FOLDER_MIME:
        return None
    if mime.startswith(NATIVE_PREFIX):
        export = _export_for(mime, export_formats)
        if not export:
            return None  # forms, drawings, shortcuts, ...: nothing to extract
        export_ext, export_mime = export
    return RemoteFile(
        id=item["id"],
        name=item["name"],
        path=path,
        # `version` also bumps on metadata-only changes; the sync prefers
        # md5Checksum when available (binary files).
        revision=str(item.get("version", "")),
        mime_type=mime,
        content_hash=item.get("md5Checksum"),
        modified_at=_parse_time(item.get("modifiedTime")),
        size=int(item["size"]) if item.get("size") else None,
        export_mime=export_mime,
        export_extension=export_ext,
        web_url=item.get("webViewLink"),
    )


class GoogleDriveProvider(StorageProvider):
    name = "google_drive"
    display_name = "Google Drive"
    console_url = "https://console.cloud.google.com/apis/credentials"
    root_folder_id = "root"

    def folder_web_url(self, folder_id: str, path: str) -> Optional[str]:
        if folder_id == self.root_folder_id:
            return "https://drive.google.com/drive/my-drive"
        return _folder_url(folder_id)

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": SCOPE,
            "access_type": "offline",
            # Always re-consent so Google returns a refresh token
            "prompt": "consent",
            "include_granted_scopes": "true",
            "state": state,
        }
        return f"{AUTHORIZE_URL}?{urlencode(params)}"

    async def _token_request(self, data: Dict[str, str]) -> TokenSet:
        async with self._client() as client:
            response = await client.post(
                TOKEN_URL,
                data={
                    **data,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                },
            )
        self._raise_for_status(response)
        payload = response.json()
        expires_in = payload.get("expires_in")
        return TokenSet(
            access_token=payload["access_token"],
            refresh_token=payload.get("refresh_token"),
            expires_at=(
                datetime.now(timezone.utc) + timedelta(seconds=int(expires_in))
                if expires_in
                else None
            ),
            scopes=payload.get("scope"),
        )

    async def exchange_code(self, code: str, redirect_uri: str) -> TokenSet:
        return await self._token_request(
            {
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect_uri,
            }
        )

    async def refresh(self, refresh_token: str) -> TokenSet:
        tokens = await self._token_request(
            {"grant_type": "refresh_token", "refresh_token": refresh_token}
        )
        tokens.refresh_token = tokens.refresh_token or refresh_token
        return tokens

    async def _get(
        self, access_token: str, path: str, params: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        async with self._client() as client:
            response = await client.get(
                f"{API_URL}/{path}",
                params=params,
                headers={"Authorization": f"Bearer {access_token}"},
            )
        self._raise_for_status(response)
        return response.json()

    async def _list_query(
        self,
        access_token: str,
        query: str,
        all_drives: bool = True,
        max_items: Optional[int] = None,
        extra_fields: str = "",
    ) -> List[Dict[str, Any]]:
        params: Dict[str, Any] = {
            "q": query,
            "fields": f"nextPageToken,files({FILE_FIELDS}{extra_fields})",
            "pageSize": min(max_items or 1000, 1000),
            "orderBy": "folder,name",
            "supportsAllDrives": "true",
            "includeItemsFromAllDrives": "true",
        }
        if all_drives:
            # folders may live in a shared drive, not only in the user's corpus
            params["corpora"] = "allDrives"
        items: List[Dict[str, Any]] = []
        while True:
            data = await self._get(access_token, "files", params)
            items.extend(data.get("files", []))
            token = data.get("nextPageToken")
            if not token or (max_items is not None and len(items) >= max_items):
                return items
            params["pageToken"] = token

    async def _list_children(
        self, access_token: str, parent_id: str, folders_only: bool = False
    ) -> List[Dict[str, Any]]:
        query = f"'{_escape(parent_id)}' in parents and trashed = false"
        if folders_only:
            query += f" and mimeType = '{FOLDER_MIME}'"
        return await self._list_query(access_token, query)

    async def _shared_drives(self, access_token: str) -> List[RemoteFolder]:
        params: Dict[str, Any] = {"pageSize": 100, "fields": "nextPageToken,drives(id,name)"}
        drives: List[RemoteFolder] = []
        while True:
            data = await self._get(access_token, "drives", params)
            drives.extend(
                RemoteFolder(
                    id=d["id"], name=d["name"], path=f"/Shared drives/{d['name']}",
                    web_url=_folder_url(d["id"]),
                )
                for d in data.get("drives", [])
            )
            token = data.get("nextPageToken")
            if not token:
                return drives
            params["pageToken"] = token

    async def get_account(self, access_token: str) -> AccountInfo:
        data = await self._get(
            access_token, "about", {"fields": "user(displayName,emailAddress,permissionId)"}
        )
        user = data.get("user") or {}
        return AccountInfo(
            external_id=user.get("permissionId") or user.get("emailAddress") or "google",
            name=user.get("displayName") or user.get("emailAddress") or "Google Drive",
            email=user.get("emailAddress"),
        )

    async def _my_drive_root_id(self, access_token: str) -> Optional[str]:
        if not hasattr(self, "_root_id"):
            meta = await self._get(access_token, "files/root", {"fields": "id"})
            self._root_id: Optional[str] = meta.get("id")
        return self._root_id

    async def _folder_path(self, access_token: str, folder_id: str) -> str:
        """Human-readable path of a folder, walking up its parents (memoised
        per provider instance: search results often share folders)."""
        cache: Dict[str, str] = self.__dict__.setdefault("_path_cache", {})
        if folder_id in cache:
            return cache[folder_id]
        path = await self._walk_folder_path(access_token, folder_id)
        cache[folder_id] = path
        return path

    async def _walk_folder_path(self, access_token: str, folder_id: str) -> str:
        parts: List[str] = []
        current: Optional[str] = folder_id
        for _ in range(MAX_PATH_DEPTH):
            if not current or current == self.root_folder_id:
                break
            meta = await self._get(
                access_token,
                f"files/{current}",
                {"fields": "id,name,parents,driveId", "supportsAllDrives": "true"},
            )
            parents = meta.get("parents") or []
            if not parents:
                # My Drive root: no name. Shared-drive root or an item shared
                # with me (its parents are not visible): keep its name.
                if meta.get("id") != await self._my_drive_root_id(access_token):
                    parts.append(meta.get("name", ""))
                break
            parts.append(meta.get("name", ""))
            current = parents[0]
        return "/" + "/".join(reversed(parts))

    def _split_items(
        self, items: List[Dict[str, Any]], prefix: str, export_formats: Dict[str, str]
    ) -> Tuple[List[RemoteFolder], List[RemoteFile]]:
        folders: List[RemoteFolder] = []
        files: List[RemoteFile] = []
        for item in items:
            path = f"{prefix}/{item['name']}"
            if item.get("mimeType") == FOLDER_MIME:
                folders.append(
                    RemoteFolder(id=item["id"], name=item["name"], path=path, web_url=_folder_url(item["id"]))
                )
            else:
                remote = _to_remote(item, path, export_formats)
                if remote:
                    files.append(remote)
        return folders, files

    async def list_children(
        self, access_token: str, parent_id: Optional[str], export_formats: Dict[str, str]
    ) -> Tuple[str, List[RemoteFolder], List[RemoteFile]]:
        parent = parent_id or self.root_folder_id
        if parent == SHARED_WITH_ME:
            items = await self._list_query(
                access_token, "sharedWithMe = true and trashed = false", all_drives=False
            )
            folders, files = self._split_items(items, "/Shared with me", export_formats)
            return "/Shared with me", folders, files
        if parent == SHARED_DRIVES:
            return "/Shared drives", await self._shared_drives(access_token), []

        base = await self._folder_path(access_token, parent)
        items = await self._list_children(access_token, parent)
        folders, files = self._split_items(items, base.rstrip("/"), export_formats)
        if parent == self.root_folder_id:
            folders = [
                RemoteFolder(id=SHARED_WITH_ME, name="Shared with me", path="/Shared with me",
                             web_url="https://drive.google.com/drive/shared-with-me", selectable=False),
                RemoteFolder(id=SHARED_DRIVES, name="Shared drives", path="/Shared drives",
                             web_url="https://drive.google.com/drive/shared-drives", selectable=False),
            ] + folders
        return base, folders, files

    async def search(
        self, access_token: str, query: str, export_formats: Dict[str, str], limit: int
    ) -> Tuple[List[RemoteFolder], List[RemoteFile], bool]:
        q = f"name contains '{_escape(query)}' and trashed = false"
        items = await self._list_query(
            access_token, q, max_items=limit + 1, extra_fields=",parents"
        )
        truncated = len(items) > limit
        folders: List[RemoteFolder] = []
        files: List[RemoteFile] = []
        for item in items[:limit]:
            parents = item.get("parents") or []
            base = (await self._folder_path(access_token, parents[0])).rstrip("/") if parents else ""
            path = f"{base}/{item['name']}"
            if item.get("mimeType") == FOLDER_MIME:
                folders.append(
                    RemoteFolder(id=item["id"], name=item["name"], path=path, web_url=_folder_url(item["id"]))
                )
            else:
                remote = _to_remote(item, path, export_formats)
                if remote:
                    files.append(remote)
        return folders, files, truncated

    async def get_file(
        self, access_token: str, file_id: str, export_formats: Dict[str, str]
    ) -> Optional[RemoteFile]:
        try:
            item = await self._get(
                access_token,
                f"files/{file_id}",
                {"fields": f"{FILE_FIELDS},parents", "supportsAllDrives": "true"},
            )
        except RemoteNotFoundError:
            return None
        if item.get("trashed"):
            return None
        parents = item.get("parents") or []
        base = await self._folder_path(access_token, parents[0]) if parents else ""
        return _to_remote(item, f"{base.rstrip('/')}/{item['name']}", export_formats)

    async def folder_exists(self, access_token: str, folder_id: str) -> bool:
        if folder_id == self.root_folder_id:
            return True
        try:
            meta = await self._get(
                access_token,
                f"files/{folder_id}",
                {"fields": "id,mimeType,trashed", "supportsAllDrives": "true"},
            )
        except RemoteNotFoundError:
            return False
        return meta.get("mimeType") == FOLDER_MIME and not meta.get("trashed", False)

    async def list_files(
        self,
        access_token: str,
        folder_id: str,
        recursive: bool,
        export_formats: Dict[str, str],
    ) -> List[RemoteFile]:
        files: Dict[str, RemoteFile] = {}
        visited: set[str] = set()
        queue: deque[Tuple[str, str]] = deque([(folder_id, "")])
        while queue:
            current, rel_path = queue.popleft()
            if current in visited:
                continue
            visited.add(current)
            for item in await self._list_children(access_token, current):
                path = f"{rel_path}/{item['name']}"
                if item.get("mimeType") == FOLDER_MIME:
                    if recursive:
                        queue.append((item["id"], path))
                    continue
                remote = _to_remote(item, path, export_formats)
                if remote:
                    files[item["id"]] = remote
        return list(files.values())

    async def download(self, access_token: str, file: RemoteFile, dest_path: str) -> None:
        headers = {"Authorization": f"Bearer {access_token}"}
        if file.export_mime:
            request = httpx.Request(
                "GET",
                f"{API_URL}/files/{file.id}/export",
                params={"mimeType": file.export_mime},
                headers=headers,
            )
        else:
            request = httpx.Request(
                "GET",
                f"{API_URL}/files/{file.id}",
                params={"alt": "media", "supportsAllDrives": "true"},
                headers=headers,
            )
        await self._stream_to_file(request, dest_path)
