"""Dropbox connector (HTTP API v2, OAuth2 with offline refresh tokens)."""

import json
import posixpath
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import quote, urlencode

import httpx

from open_notebook.exceptions import InvalidInputError
from open_notebook.integrations.base import (
    SHARED_WITH_ME,
    AccountInfo,
    ProviderAuthError,
    ProviderError,
    RemoteFile,
    RemoteFolder,
    StorageProvider,
    TokenSet,
)

AUTHORIZE_URL = "https://www.dropbox.com/oauth2/authorize"
TOKEN_URL = "https://api.dropboxapi.com/oauth2/token"
API_URL = "https://api.dropboxapi.com/2"
CONTENT_URL = "https://content.dropboxapi.com/2"

# Dropbox reports endpoint errors as HTTP 409 with an error_summary string
NOT_FOUND_MARKERS = ("path/not_found", "path_lookup/not_found", "not_found/")


def _parse_time(value: Optional[str]) -> Optional[datetime]:
    if not value:
        return None
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def _web_url(path: str, is_folder: bool) -> str:
    if is_folder:
        return f"https://www.dropbox.com/home{quote(path)}"
    parent, name = posixpath.split(path)
    return f"https://www.dropbox.com/home{quote(parent)}?preview={quote(name)}"


def _file(entry: Dict[str, Any], base: str = "") -> RemoteFile:
    # Entries of a shared folder that is not in the user's Dropbox have no
    # path_display: build a path under the folder instead, and no web link.
    display = entry.get("path_display")
    path = display or f"{base}/{entry['name']}"
    return RemoteFile(
        id=entry["id"],
        name=entry["name"],
        path=path,
        revision=entry["rev"],
        content_hash=entry.get("content_hash"),
        modified_at=_parse_time(entry.get("server_modified")),
        size=entry.get("size"),
        web_url=_web_url(path, False) if display else None,
    )


def _folder(entry: Dict[str, Any], base: str = "") -> RemoteFolder:
    display = entry.get("path_display")
    path = display or f"{base}/{entry['name']}"
    return RemoteFolder(
        id=entry["id"], name=entry["name"], path=path,
        web_url=_web_url(path, True) if display else None,
    )


def _is_file(entry: Dict[str, Any]) -> bool:
    return entry.get(".tag") == "file" and entry.get("is_downloadable", True)


def _token_set(payload: Dict[str, Any]) -> TokenSet:
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


class DropboxProvider(StorageProvider):
    name = "dropbox"
    display_name = "Dropbox"
    console_url = "https://www.dropbox.com/developers/apps"
    # Dropbox addresses the root with an empty path
    root_folder_id = ""

    def folder_web_url(self, folder_id: str, path: str) -> Optional[str]:
        return _web_url(path if path.startswith("/") else f"/{path}", True)

    def authorize_url(self, state: str, redirect_uri: str) -> str:
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "redirect_uri": redirect_uri,
            "state": state,
            "token_access_type": "offline",
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
        return _token_set(response.json())

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
        # Dropbox refresh tokens are long-lived and are not rotated
        tokens.refresh_token = tokens.refresh_token or refresh_token
        return tokens

    async def _rpc(self, access_token: str, endpoint: str, body: Any) -> Dict[str, Any]:
        async with self._client() as client:
            response = await client.post(
                f"{API_URL}/{endpoint}",
                headers={
                    "Authorization": f"Bearer {access_token}",
                    "Content-Type": "application/json",
                },
                content=json.dumps(body),
            )
        self._raise_for_status(response, NOT_FOUND_MARKERS)
        return response.json()

    async def get_account(self, access_token: str) -> AccountInfo:
        data = await self._rpc(access_token, "users/get_current_account", None)
        return AccountInfo(
            external_id=data["account_id"],
            name=(data.get("name") or {}).get("display_name") or data.get("email") or "Dropbox",
            email=data.get("email"),
        )

    async def _list_entries(
        self, access_token: str, path: str, recursive: bool
    ) -> List[Dict[str, Any]]:
        data = await self._rpc(
            access_token,
            "files/list_folder",
            {
                "path": path,
                "recursive": recursive,
                "include_deleted": False,
                "include_non_downloadable_files": False,
                "limit": 2000,
            },
        )
        entries = list(data.get("entries", []))
        while data.get("has_more"):
            data = await self._rpc(
                access_token, "files/list_folder/continue", {"cursor": data["cursor"]}
            )
            entries.extend(data.get("entries", []))
        return entries

    async def _shared_folders(self, access_token: str) -> List[RemoteFolder]:
        """Folders shared with the user, including those not added to their
        Dropbox. Opened through their namespace (`ns:<id>`)."""
        try:
            data = await self._rpc(access_token, "sharing/list_folders", {"limit": 1000})
            entries = list(data.get("entries", []))
            while data.get("cursor"):
                data = await self._rpc(
                    access_token, "sharing/list_folders/continue", {"cursor": data["cursor"]}
                )
                entries.extend(data.get("entries", []))
        except ProviderAuthError as e:
            if "missing_scope" in str(e):
                raise InvalidInputError(
                    "To browse folders shared with you, enable the 'sharing.read' "
                    "permission of the Dropbox app and reconnect the account."
                )
            raise
        folders = [
            RemoteFolder(
                id=f"ns:{e['shared_folder_id']}",
                name=e["name"],
                path=e.get("path_display") or f"/Shared with me/{e['name']}",
                web_url=e.get("preview_url"),
            )
            for e in entries
        ]
        return sorted(folders, key=lambda f: f.name.lower())

    async def list_children(
        self, access_token: str, parent_id: Optional[str], export_formats: Dict[str, str]
    ) -> Tuple[str, List[RemoteFolder], List[RemoteFile]]:
        parent = parent_id or self.root_folder_id
        if parent == SHARED_WITH_ME:
            return "/Shared with me", await self._shared_folders(access_token), []
        path = "/"
        if parent.startswith("ns:"):
            path = "/Shared with me"  # namespace roots have no path of their own
        elif parent != self.root_folder_id:
            meta = await self._rpc(access_token, "files/get_metadata", {"path": parent})
            path = meta.get("path_display") or "/"
        entries = await self._list_entries(access_token, parent, False)
        base = path.rstrip("/")
        folders = sorted(
            (_folder(e, base) for e in entries if e.get(".tag") == "folder"),
            key=lambda f: f.name.lower(),
        )
        files = sorted((_file(e, base) for e in entries if _is_file(e)), key=lambda f: f.name.lower())
        if parent == self.root_folder_id:
            folders = [
                RemoteFolder(id=SHARED_WITH_ME, name="Shared with me", path="/Shared with me",
                             web_url="https://www.dropbox.com/share", selectable=False)
            ] + folders
        return path, folders, files

    async def search(
        self, access_token: str, query: str, export_formats: Dict[str, str], limit: int
    ) -> Tuple[List[RemoteFolder], List[RemoteFile], bool]:
        data = await self._rpc(
            access_token,
            "files/search_v2",
            {
                "query": query,
                "options": {
                    "max_results": min(limit, 1000),
                    "file_status": "active",
                    "filename_only": True,
                },
            },
        )
        folders: List[RemoteFolder] = []
        files: List[RemoteFile] = []
        for match in data.get("matches", []):
            entry = (match.get("metadata") or {}).get("metadata") or {}
            if entry.get(".tag") == "folder":
                folders.append(_folder(entry))
            elif _is_file(entry):
                files.append(_file(entry))
        return folders, files, bool(data.get("has_more"))

    async def get_file(
        self, access_token: str, file_id: str, export_formats: Dict[str, str]
    ) -> Optional[RemoteFile]:
        try:
            meta = await self._rpc(access_token, "files/get_metadata", {"path": file_id})
        except ProviderError as e:
            if "not_found" in str(e):
                return None
            raise
        return _file(meta) if _is_file(meta) else None

    async def folder_exists(self, access_token: str, folder_id: str) -> bool:
        if folder_id == self.root_folder_id:
            return True
        if folder_id.startswith("ns:"):
            # get_metadata does not accept a namespace root: probe a listing
            try:
                await self._rpc(access_token, "files/list_folder", {"path": folder_id, "limit": 1})
                return True
            except ProviderError as e:
                if "not_found" in str(e) or "no_permission" in str(e):
                    return False
                raise
        try:
            data = await self._rpc(access_token, "files/get_metadata", {"path": folder_id})
        except ProviderError as e:
            if "not_found" in str(e):
                return False
            raise
        return data.get(".tag") == "folder"

    async def list_files(
        self,
        access_token: str,
        folder_id: str,
        recursive: bool,
        export_formats: Dict[str, str],
    ) -> List[RemoteFile]:
        entries = await self._list_entries(access_token, folder_id, recursive)
        return [_file(e) for e in entries if _is_file(e)]

    async def download(self, access_token: str, file: RemoteFile, dest_path: str) -> None:
        request = httpx.Request(
            "POST",
            f"{CONTENT_URL}/files/download",
            headers={
                "Authorization": f"Bearer {access_token}",
                # json.dumps escapes non-ASCII, as HTTP headers require
                "Dropbox-API-Arg": json.dumps({"path": file.id}),
            },
        )
        await self._stream_to_file(request, dest_path, NOT_FOUND_MARKERS)
