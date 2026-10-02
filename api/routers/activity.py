"""Activity: background jobs in progress and recently finished."""

from fastapi import APIRouter, Query

from api import activity_service
from api.models import (
    ActivityCounts,
    ActivityResponse,
    CancelJobsResponse,
    CancelTargetRequest,
    DismissResponse,
)

router = APIRouter()


@router.get("/activity", response_model=ActivityResponse)
async def get_activity(
    hours: int = Query(24, ge=1, le=168, description="How far back finished jobs go"),
    limit: int = Query(200, ge=1, le=500, description="Max jobs per list"),
):
    return await activity_service.get_activity(hours=hours, limit=limit)


@router.get("/activity/summary", response_model=ActivityCounts)
async def get_activity_summary(
    hours: int = Query(24, ge=1, le=168),
):
    """Counts only - cheap enough to poll for a badge."""
    return await activity_service.get_counts(hours=hours)


@router.post("/activity/jobs/{job_id}/cancel", response_model=CancelJobsResponse)
async def cancel_job(job_id: str):
    """Stop a queued or running job (running ones stop within a few seconds)."""
    return await activity_service.cancel_job(job_id)


@router.post("/activity/targets/cancel", response_model=CancelJobsResponse)
async def cancel_target(data: CancelTargetRequest):
    """Stop every job working on a source or cloud link; optionally delete the source."""
    return await activity_service.cancel_target(
        data.target_type, data.target_id, data.delete_target
    )


@router.post("/activity/jobs/{job_id}/dismiss", response_model=DismissResponse)
async def dismiss_job(job_id: str):
    """Hide a finished job from the activity list."""
    await activity_service.dismiss_job(job_id)
    return DismissResponse(dismissed=1)


@router.post("/activity/dismiss-finished", response_model=DismissResponse)
async def dismiss_finished(hours: int = Query(24, ge=1, le=168)):
    """Hide every finished job of the window from the activity list."""
    return DismissResponse(dismissed=await activity_service.dismiss_finished(hours))
