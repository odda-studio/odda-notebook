"""
Activity view: every background job (surreal-commands `command` rows) that is
queued/running, plus the ones finished recently, resolved to what they act on
(source, note, cloud link, podcast) so the UI can follow a file through
extraction -> transformations -> embedding.

Relies on the timeline fields added to `command` by migration 29; jobs that
finished before it have no `finished_at` and only show while active.
"""

from datetime import datetime
from typing import Any, Dict, List, Optional, Set

from api.models import (
    ActivityCounts,
    ActivityJob,
    ActivityResponse,
    CancelJobsResponse,
)
from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.notebook import Source
from open_notebook.exceptions import InvalidInputError, NotFoundError
from open_notebook.utils.job_cancellation import request_cancel

ACTIVE_STATUSES = ["new", "running"]
FINISHED_STATUSES = ["completed", "failed", "canceled"]
MAX_ERROR_LENGTH = 300

# command name -> stage shown in the UI
STAGES: Dict[str, str] = {
    "process_source": "extraction",
    "run_transformation": "transformation",
    "create_insight": "insight",
    "embed_source": "embedding",
    "embed_insight": "insight_embedding",
    "embed_note": "note_embedding",
    "sync_link": "cloud_sync",
    "generate_podcast": "podcast",
    "rebuild_embeddings": "rebuild_embeddings",
}

_FIELDS = (
    "id, name, status, args, error_message, created, started_at, finished_at, cancel_requested"
)
# dismissed jobs are hidden from the activity view
_VISIBLE = "(dismissed = NONE OR dismissed = false)"


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


def _error(row: Dict[str, Any]) -> Optional[str]:
    message = row.get("error_message") or None
    return message[:MAX_ERROR_LENGTH] if message else None


async def _titles(table: str, ids: Set[str], field: str = "title") -> Dict[str, str]:
    if not ids:
        return {}
    rows = await repo_query(
        f"SELECT id, {field} AS label FROM {table} WHERE id IN $ids",
        {"ids": [ensure_record_id(i) for i in ids]},
    )
    return {str(r["id"]): r.get("label") or "" for r in rows}


async def _to_jobs(rows: List[Dict[str, Any]]) -> List[ActivityJob]:
    args_of = [r.get("args") or {} for r in rows]

    insight_ids = {str(a["insight_id"]) for a in args_of if a.get("insight_id")}
    insight_sources: Dict[str, str] = {}
    if insight_ids:
        insight_rows = await repo_query(
            "SELECT id, source FROM source_insight WHERE id IN $ids",
            {"ids": [ensure_record_id(i) for i in insight_ids]},
        )
        insight_sources = {str(r["id"]): str(r["source"]) for r in insight_rows if r.get("source")}

    source_ids = {str(a["source_id"]) for a in args_of if a.get("source_id")}
    source_ids |= set(insight_sources.values())
    sources = await _titles("source", source_ids)
    notes = await _titles("note", {str(a["note_id"]) for a in args_of if a.get("note_id")})
    links = await _titles("sync_link", {str(a["link_id"]) for a in args_of if a.get("link_id")}, "name")
    transformations = await _titles(
        "transformation",
        {str(a["transformation_id"]) for a in args_of if a.get("transformation_id")},
    )

    jobs: List[ActivityJob] = []
    for row, args in zip(rows, args_of):
        name = row.get("name") or ""
        target_type: Optional[str] = None
        target_id: Optional[str] = None
        target_title: Optional[str] = None
        detail: Optional[str] = None

        source_id = args.get("source_id") or insight_sources.get(str(args.get("insight_id")))
        if source_id:
            target_type, target_id = "source", str(source_id)
            target_title = sources.get(target_id)
        elif args.get("note_id"):
            target_type, target_id = "note", str(args["note_id"])
            target_title = notes.get(target_id)
        elif args.get("link_id"):
            target_type, target_id = "link", str(args["link_id"])
            target_title = links.get(target_id)
        elif name == "generate_podcast":
            target_type, target_title = "podcast", args.get("episode_name")

        if args.get("transformation_id"):
            detail = transformations.get(str(args["transformation_id"]))
        elif args.get("insight_type"):
            detail = args["insight_type"]
        elif name == "process_source" and args.get("transformations"):
            detail = str(len(args["transformations"]))  # transformations queued with it

        status = row.get("status") or "new"
        cancel_requested = bool(row.get("cancel_requested"))
        # surreal-commands records a canceled job as failed; show what happened
        if cancel_requested and status in ("failed", "canceled"):
            status = "canceled"
        jobs.append(
            ActivityJob(
                id=str(row["id"]),
                name=name,
                stage=STAGES.get(name, "other"),
                status=status,
                created=_iso(row.get("created")),
                started_at=_iso(row.get("started_at")),
                finished_at=_iso(row.get("finished_at")),
                error=_error(row) if status == "failed" else None,
                cancel_requested=cancel_requested,
                target_type=target_type,
                target_id=target_id,
                # the source/note may have been deleted since
                target_exists=bool(target_title is not None) if target_id else False,
                target_title=target_title,
                detail=detail,
                retryable=(
                    status == "failed" and name == "process_source" and target_id in sources
                ),
            )
        )
    return jobs


async def get_counts(hours: int = 24) -> ActivityCounts:
    active = await repo_query(
        "SELECT status, count() AS n FROM command WHERE status IN $statuses "
        f"AND {_VISIBLE} GROUP BY status",
        {"statuses": ACTIVE_STATUSES},
    )
    by_status = {r["status"]: r["n"] for r in active}
    failed = await repo_query(
        "SELECT count() AS n FROM command WHERE status = 'failed' "
        "AND (cancel_requested = NONE OR cancel_requested = false) "
        f"AND {_VISIBLE} "
        "AND finished_at != NONE AND finished_at > time::now() - type::duration($window) GROUP ALL",
        {"window": f"{hours}h"},
    )
    return ActivityCounts(
        queued=by_status.get("new", 0),
        running=by_status.get("running", 0),
        active=by_status.get("new", 0) + by_status.get("running", 0),
        failed_recent=failed[0]["n"] if failed else 0,
    )


async def get_activity(hours: int = 24, limit: int = 200) -> ActivityResponse:
    active_rows = await repo_query(
        f"SELECT {_FIELDS} FROM command WHERE status IN $statuses AND {_VISIBLE} "
        "ORDER BY created ASC LIMIT $limit",
        {"statuses": ACTIVE_STATUSES, "limit": limit},
    )
    recent_rows = await repo_query(
        f"SELECT {_FIELDS} FROM command WHERE status IN $statuses AND {_VISIBLE} "
        "AND finished_at != NONE AND finished_at > time::now() - type::duration($window) "
        "ORDER BY finished_at DESC LIMIT $limit",
        {"statuses": FINISHED_STATUSES, "window": f"{hours}h", "limit": limit},
    )
    return ActivityResponse(
        active=await _to_jobs(active_rows),
        recent=await _to_jobs(recent_rows),
        counts=await get_counts(hours),
    )


# =============================================================================
# Actions
# =============================================================================


async def cancel_job(job_id: str) -> CancelJobsResponse:
    status = await request_cancel(job_id)
    if status is None:
        raise InvalidInputError("The job is not queued or running")
    return CancelJobsResponse(
        canceled=1, stopping=1 if status == "running" else 0, deleted_target=False
    )


async def cancel_target(
    target_type: str, target_id: str, delete_target: bool
) -> CancelJobsResponse:
    """Cancel every queued/running job working on a source or cloud link,
    optionally deleting the source itself."""
    rows = await repo_query(
        f"SELECT {_FIELDS} FROM command WHERE status IN $statuses",
        {"statuses": ACTIVE_STATUSES},
    )
    jobs = [
        j for j in await _to_jobs(rows)
        if j.target_type == target_type and j.target_id == target_id
    ]
    canceled = stopping = 0
    for job in jobs:
        status = await request_cancel(job.id)
        if status:
            canceled += 1
            stopping += status == "running"

    deleted = False
    if delete_target:
        if target_type != "source":
            raise InvalidInputError("Only sources can be deleted from the activity view")
        try:
            await (await Source.get(target_id)).delete()
            deleted = True
        except NotFoundError:
            pass
    return CancelJobsResponse(canceled=canceled, stopping=stopping, deleted_target=deleted)


async def dismiss_job(job_id: str) -> None:
    rows = await repo_query(
        "UPDATE $id SET dismissed = true WHERE status IN $statuses RETURN AFTER",
        {"id": ensure_record_id(job_id), "statuses": FINISHED_STATUSES},
    )
    if not rows:
        raise InvalidInputError("Only finished jobs can be removed from the list")


async def dismiss_finished(hours: int) -> int:
    rows = await repo_query(
        f"UPDATE command SET dismissed = true WHERE status IN $statuses AND {_VISIBLE} "
        "AND finished_at != NONE AND finished_at > time::now() - type::duration($window) "
        "RETURN id",
        {"statuses": FINISHED_STATUSES, "window": f"{hours}h"},
    )
    return len(rows)


