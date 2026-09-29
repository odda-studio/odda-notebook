"""Notebook default transformations (migration 28).

A notebook can list transformations to run on every source added to it:

- a **new** source created in one or more notebooks runs the union of their
  defaults together with the transformations requested explicitly
  (``merge_transformation_ids``);
- an **existing** source linked to a notebook runs only the defaults it
  doesn't have yet (``apply_missing_notebook_defaults``), so re-linking never
  duplicates insights.
"""

import asyncio
from typing import Iterable, List, Optional, Sequence, Set

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query


def merge_transformation_ids(*lists: Optional[Iterable[str]]) -> List[str]:
    """Union of transformation ids, order-preserving, without duplicates."""
    merged: List[str] = []
    for ids in lists:
        for transformation_id in ids or []:
            transformation_id = str(transformation_id)
            if transformation_id and transformation_id not in merged:
                merged.append(transformation_id)
    return merged


async def notebook_default_transformations(notebook_ids: Sequence[str]) -> List[str]:
    """Union of the default transformations of the given notebooks."""
    ids = [str(n) for n in notebook_ids if n]
    if not ids:
        return []
    rows = await repo_query(
        "SELECT id, default_transformations FROM notebook WHERE id IN $ids",
        {"ids": [ensure_record_id(n) for n in ids]},
    )
    by_notebook = {str(r["id"]): r.get("default_transformations") or [] for r in rows}
    # keep the caller's notebook order so the merged order is predictable
    return merge_transformation_ids(*(by_notebook.get(n, []) for n in ids))


async def applied_transformation_ids(source_id: str, candidates: Sequence[str]) -> Set[str]:
    """Which of ``candidates`` already produced an insight on the source.

    Insights created after migration 28 reference their transformation; older
    ones only carry its title in ``insight_type``, matched as a fallback.
    """
    if not candidates:
        return set()
    insights = await repo_query(
        "SELECT transformation, insight_type FROM source_insight WHERE source = $source",
        {"source": ensure_record_id(source_id)},
    )
    applied = {str(i["transformation"]) for i in insights if i.get("transformation")}
    legacy_titles = {i.get("insight_type") for i in insights if not i.get("transformation")}
    if legacy_titles:
        rows = await repo_query(
            "SELECT id, title FROM transformation WHERE id IN $ids",
            {"ids": [ensure_record_id(t) for t in candidates]},
        )
        applied |= {str(r["id"]) for r in rows if r.get("title") in legacy_titles}
    return applied & {str(c) for c in candidates}


async def missing_notebook_defaults(source_id: str, notebook_ids: Sequence[str]) -> List[str]:
    defaults = await notebook_default_transformations(notebook_ids)
    if not defaults:
        return []
    applied = await applied_transformation_ids(source_id, defaults)
    return [t for t in defaults if t not in applied]


async def apply_missing_notebook_defaults(
    source_id: str, notebook_ids: Sequence[str]
) -> List[str]:
    """Queue the notebooks' default transformations the source doesn't have
    yet. Returns the transformation ids queued (empty if none or if the source
    has no text yet - a source still being processed gets its defaults from
    its own processing job)."""
    missing = await missing_notebook_defaults(source_id, notebook_ids)
    if not missing:
        return []
    rows = await repo_query(
        "SELECT full_text != NONE AND full_text != '' AS has_text FROM $source",
        {"source": ensure_record_id(source_id)},
    )
    if not rows or not rows[0].get("has_text"):
        logger.info(
            f"Source {source_id} has no text yet; skipping notebook default transformations"
        )
        return []

    from surreal_commands import submit_command

    import commands.source_commands  # noqa: F401  (registers run_transformation)

    queued: List[str] = []
    for transformation_id in missing:
        try:
            await asyncio.to_thread(
                submit_command,
                "open_notebook",
                "run_transformation",
                {"source_id": str(source_id), "transformation_id": transformation_id},
            )
            queued.append(transformation_id)
        except Exception as e:
            logger.warning(
                f"Could not queue transformation {transformation_id} for {source_id}: {e}"
            )
    if queued:
        logger.info(f"Queued {len(queued)} notebook default transformation(s) for {source_id}")
    return queued
