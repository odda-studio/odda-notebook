"""
Integrations Router

Thin HTTP layer for cloud-storage sync (Dropbox, Google Drive). Business logic
lives in api.integrations_service; sync execution in open_notebook.integrations.

The OAuth callback endpoints are excluded from password auth (a browser
redirect carries no Bearer token); they are protected by the signed `state`.

NEVER returns secrets (client secret, OAuth tokens) - metadata only.
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import RedirectResponse

from api import integrations_service as service
from api.models import (
    AuthorizeUrlResponse,
    BrowseResponse,
    IntegrationAccountResponse,
    IntegrationMessageResponse,
    IntegrationProviderResponse,
    IntegrationProviderUpdate,
    IntegrationSettingsResponse,
    IntegrationSettingsUpdate,
    LinkImportRequest,
    LinkImportResponse,
    SourceCloudInfoResponse,
    SourceSyncUpdate,
    SyncedFileExcludeRequest,
    SyncedFileResponse,
    SyncedFileUpdate,
    SyncLinkResponse,
    SyncLinkUpdate,
    SyncTriggerResponse,
)

router = APIRouter(prefix="/integrations")


def _conflict(e: service.ManagedByEnvironmentError) -> HTTPException:
    return HTTPException(status_code=409, detail=str(e))


# --- Provider app credentials -------------------------------------------------


@router.get("/providers", response_model=List[IntegrationProviderResponse])
async def list_providers():
    return await service.list_providers()


@router.put("/providers/{provider}", response_model=IntegrationProviderResponse)
async def save_provider_app(provider: str, data: IntegrationProviderUpdate):
    try:
        return await service.save_provider_app(provider, data)
    except service.ManagedByEnvironmentError as e:
        raise _conflict(e)


@router.delete("/providers/{provider}", response_model=IntegrationMessageResponse)
async def delete_provider_app(provider: str):
    try:
        await service.delete_provider_app(provider)
    except service.ManagedByEnvironmentError as e:
        raise _conflict(e)
    return IntegrationMessageResponse(message="Provider app configuration removed")


# --- Global settings ------------------------------------------------------------


@router.get("/settings", response_model=IntegrationSettingsResponse)
async def get_settings():
    return await service.get_settings()


@router.put("/settings", response_model=IntegrationSettingsResponse)
async def update_settings(data: IntegrationSettingsUpdate):
    try:
        return await service.update_settings(data)
    except service.ManagedByEnvironmentError as e:
        raise _conflict(e)


# --- OAuth ----------------------------------------------------------------------


@router.post("/providers/{provider}/authorize", response_model=AuthorizeUrlResponse)
async def authorize(provider: str):
    return AuthorizeUrlResponse(authorize_url=await service.start_authorize(provider))


@router.get("/providers/{provider}/callback", include_in_schema=False)
async def oauth_callback(
    provider: str,
    code: Optional[str] = None,
    state: Optional[str] = None,
    error: Optional[str] = None,
):
    url = await service.complete_authorize(provider, code, state, error)
    return RedirectResponse(url, status_code=302)


# --- Accounts -------------------------------------------------------------------


@router.get("/accounts", response_model=List[IntegrationAccountResponse])
async def list_accounts():
    return await service.list_accounts()


@router.delete("/accounts/{account_id}", response_model=IntegrationMessageResponse)
async def delete_account(account_id: str):
    await service.delete_account(account_id)
    return IntegrationMessageResponse(message="Account disconnected")


@router.get("/accounts/{account_id}/browse", response_model=BrowseResponse)
async def browse(account_id: str, parent_id: Optional[str] = Query(None)):
    return await service.browse(account_id, parent_id)


# --- Links (imported files/folders) ---------------------------------------------


def _queued_or_conflict(command_id: Optional[str]) -> SyncTriggerResponse:
    if not command_id:
        raise HTTPException(status_code=409, detail="A sync is already queued or running")
    return SyncTriggerResponse(command_id=command_id)


@router.get("/links", response_model=List[SyncLinkResponse])
async def list_links(notebook_id: Optional[str] = Query(None)):
    return await service.list_links(notebook_id)


@router.post("/links/import", response_model=LinkImportResponse)
async def import_links(data: LinkImportRequest):
    return await service.import_links(data)


@router.put("/links/{link_id}", response_model=SyncLinkResponse)
async def update_link(link_id: str, data: SyncLinkUpdate):
    return await service.update_link(link_id, data)


@router.delete("/links/{link_id}", response_model=IntegrationMessageResponse)
async def delete_link(link_id: str):
    await service.delete_link(link_id)
    return IntegrationMessageResponse(message="Link removed; imported sources were kept")


@router.post("/links/{link_id}/sync", response_model=SyncTriggerResponse)
async def trigger_sync(link_id: str):
    return _queued_or_conflict(await service.trigger_sync(link_id))


@router.get("/links/{link_id}/files", response_model=List[SyncedFileResponse])
async def list_link_files(link_id: str):
    return await service.list_link_files(link_id)


# --- Single files of a link -----------------------------------------------------


@router.put("/synced-files/{file_id}", response_model=SyncedFileResponse)
async def set_file_sync(file_id: str, data: SyncedFileUpdate):
    return await service.set_file_sync(file_id, data.sync_enabled)


@router.post("/synced-files/{file_id}/exclude", response_model=SyncedFileResponse)
async def exclude_file(file_id: str, data: SyncedFileExcludeRequest):
    return await service.exclude_file(file_id, data.delete_source)


@router.post("/synced-files/{file_id}/include", response_model=SyncedFileResponse)
async def include_file(file_id: str):
    return await service.include_file(file_id)


# --- Per source -----------------------------------------------------------------


@router.get("/source-map", response_model=Dict[str, SourceCloudInfoResponse])
async def source_map():
    return await service.source_map()


@router.get("/sources/{source_id}", response_model=SourceCloudInfoResponse)
async def get_source_info(source_id: str):
    return await service.get_source_info(source_id)


@router.put("/sources/{source_id}/sync", response_model=SourceCloudInfoResponse)
async def set_source_sync(source_id: str, data: SourceSyncUpdate):
    return await service.set_source_sync(source_id, data.sync_enabled)


@router.post("/sources/{source_id}/sync", response_model=SyncTriggerResponse)
async def trigger_source_sync(source_id: str):
    return _queued_or_conflict(await service.trigger_source_sync(source_id))
