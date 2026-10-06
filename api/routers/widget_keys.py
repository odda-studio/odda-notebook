"""Widget keys admin (behind the API password): create, restrict, rotate, revoke."""

from typing import List

from fastapi import APIRouter

from api.models import (
    WidgetKeyCreate,
    WidgetKeyCreatedResponse,
    WidgetKeyResponse,
    WidgetKeyUpdate,
)
from open_notebook.domain.notebook import Notebook
from open_notebook.domain.widget import WidgetKey, normalize_origins

router = APIRouter()


def _response(key: WidgetKey) -> WidgetKeyResponse:
    return WidgetKeyResponse(
        id=str(key.id),
        notebook_id=str(key.notebook),
        name=key.name,
        key_prefix=key.key_prefix,
        enabled=key.enabled,
        allowed_origins=key.allowed_origins,
        rate_limit_per_minute=key.rate_limit_per_minute,
        daily_limit=key.daily_limit,
        created=str(key.created) if key.created else None,
        last_used_at=key.last_used_at.isoformat() if key.last_used_at else None,
    )


def _created(key: WidgetKey, plaintext: str) -> WidgetKeyCreatedResponse:
    return WidgetKeyCreatedResponse(**_response(key).model_dump(), key=plaintext)


@router.get("/notebooks/{notebook_id}/widget-keys", response_model=List[WidgetKeyResponse])
async def list_widget_keys(notebook_id: str):
    await Notebook.get(notebook_id)  # 404 if missing
    return [_response(k) for k in await WidgetKey.list_for_notebook(notebook_id)]


@router.post("/notebooks/{notebook_id}/widget-keys", response_model=WidgetKeyCreatedResponse)
async def create_widget_key(notebook_id: str, data: WidgetKeyCreate):
    notebook = await Notebook.get(notebook_id)
    key, plaintext = await WidgetKey.create_for_notebook(
        str(notebook.id),
        data.name,
        data.allowed_origins,
        data.rate_limit_per_minute,
        data.daily_limit,
    )
    return _created(key, plaintext)


@router.put("/widget-keys/{key_id}", response_model=WidgetKeyResponse)
async def update_widget_key(key_id: str, data: WidgetKeyUpdate):
    key = await WidgetKey.get(key_id)
    fields = data.model_dump(exclude_unset=True)
    if "allowed_origins" in fields and fields["allowed_origins"] is not None:
        key.allowed_origins = normalize_origins(fields.pop("allowed_origins"))
    for field in ("name", "enabled", "rate_limit_per_minute", "daily_limit"):
        if fields.get(field) is not None:
            setattr(key, field, fields[field])
    await key.save()
    return _response(key)


@router.post("/widget-keys/{key_id}/regenerate", response_model=WidgetKeyCreatedResponse)
async def regenerate_widget_key(key_id: str):
    key = await WidgetKey.get(key_id)
    plaintext = await key.regenerate()
    return _created(key, plaintext)


@router.delete("/widget-keys/{key_id}")
async def delete_widget_key(key_id: str):
    key = await WidgetKey.get(key_id)
    await key.delete()
    return {"message": "Widget key deleted"}
