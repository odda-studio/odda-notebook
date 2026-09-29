"""Transformation groups: one-level folders to organise transformations."""

from typing import Dict, List

from fastapi import APIRouter, HTTPException, Query
from loguru import logger

from api.models import (
    TransformationGroupDeleteResponse,
    TransformationGroupResponse,
    TransformationGroupWrite,
)
from open_notebook.database.repository import repo_query
from open_notebook.domain.transformation import TransformationGroup
from open_notebook.exceptions import InvalidInputError

router = APIRouter()


async def _counts() -> Dict[str, int]:
    rows = await repo_query(
        "SELECT group_id, count() AS n FROM transformation "
        "WHERE group_id != NONE GROUP BY group_id"
    )
    return {str(r["group_id"]): r["n"] for r in rows}


def _response(group: TransformationGroup, count: int) -> TransformationGroupResponse:
    return TransformationGroupResponse(
        id=str(group.id),
        name=group.name,
        transformation_count=count,
        created=str(group.created),
        updated=str(group.updated),
    )


async def _ensure_unique(name: str, exclude_id: str | None = None) -> None:
    existing = await TransformationGroup.find_by_name(name)
    if existing and str(existing.id) != exclude_id:
        raise InvalidInputError(f"A group named '{name}' already exists")


@router.get("/transformation-groups", response_model=List[TransformationGroupResponse])
async def list_groups():
    groups = sorted(
        await TransformationGroup.get_all(), key=lambda g: g.name.casefold()
    )
    counts = await _counts()
    return [_response(g, counts.get(str(g.id), 0)) for g in groups]


@router.post("/transformation-groups", response_model=TransformationGroupResponse)
async def create_group(data: TransformationGroupWrite):
    await _ensure_unique(data.name)
    group = TransformationGroup(name=data.name)
    await group.save()
    return _response(group, 0)


@router.put("/transformation-groups/{group_id}", response_model=TransformationGroupResponse)
async def rename_group(group_id: str, data: TransformationGroupWrite):
    group = await TransformationGroup.get(group_id)
    await _ensure_unique(data.name, exclude_id=str(group.id))
    group.name = data.name
    await group.save()
    return _response(group, (await _counts()).get(str(group.id), 0))


@router.delete(
    "/transformation-groups/{group_id}", response_model=TransformationGroupDeleteResponse
)
async def delete_group(
    group_id: str,
    delete_transformations: bool = Query(
        False, description="Also delete the group's transformations (default: ungroup them)"
    ),
):
    group = await TransformationGroup.get(group_id)
    members = await group.get_transformations()
    deleted = 0
    if delete_transformations:
        for transformation in members:
            try:
                await transformation.delete()
                deleted += 1
            except Exception as e:
                logger.warning(f"Failed to delete transformation {transformation.id}: {e}")
        if deleted < len(members):
            raise HTTPException(
                status_code=500,
                detail=(
                    f"Deleted {deleted} of {len(members)} transformations; "
                    "the group was kept so you can retry"
                ),
            )
    # Remaining members are ungrouped by the DB event (migration 27)
    await group.delete()
    return TransformationGroupDeleteResponse(
        message="Group deleted",
        deleted_transformations=deleted,
        ungrouped_transformations=len(members) - deleted,
    )
