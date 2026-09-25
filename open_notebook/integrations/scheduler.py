"""
Periodic scheduler for cloud-storage sync.

A small standalone process (`python -m open_notebook.integrations.scheduler`,
run by `make scheduler-start` and supervisord) that queues a `sync_link`
command for every synced link whose `next_sync_at` has passed. It does no sync work
itself - that happens in the worker (ADR-004). All state lives in SurrealDB,
so restarts are safe and several instances would not double-queue a link
(queueing is a conditional UPDATE).
"""

import asyncio
import os
from typing import Optional

from loguru import logger

from open_notebook.database.repository import ensure_record_id, repo_query
from open_notebook.domain.integration import IntegrationSettings

TICK_SECONDS_ENV = "OPEN_NOTEBOOK_SYNC_SCHEDULER_TICK_SECONDS"
ENABLE_ENV = "OPEN_NOTEBOOK_ENABLE_SYNC_SCHEDULER"
STALE_AFTER = "1h"


def scheduler_forced_off() -> bool:
    return os.environ.get(ENABLE_ENV, "true").strip().lower() in ("false", "0", "no", "off")


async def enqueue_sync(link_id: str) -> Optional[str]:
    """Queue a sync unless one is already queued/running. Returns the command id."""
    from surreal_commands import submit_command

    import commands.integration_commands  # noqa: F401  (registers sync_link)

    record_id = ensure_record_id(link_id)
    claimed = await repo_query(
        "UPDATE $id SET status = 'queued', status_changed_at = time::now() "
        "WHERE status IN ['idle', 'error'] RETURN AFTER",
        {"id": record_id},
    )
    if not claimed:
        return None
    try:
        command_id = await asyncio.to_thread(
            submit_command, "open_notebook", "sync_link", {"link_id": link_id}
        )
    except Exception:
        await repo_query(
            "UPDATE $id SET status = 'error', last_error = 'Failed to queue sync', "
            "status_changed_at = time::now()",
            {"id": record_id},
        )
        raise
    await repo_query(
        "UPDATE $id SET command = $command",
        {"id": record_id, "command": ensure_record_id(str(command_id))},
    )
    return str(command_id)


async def recover_stale() -> None:
    """A worker crash can leave a link queued/running forever; release it."""
    await repo_query(
        "UPDATE sync_link SET status = 'error', "
        "last_error = 'Sync did not finish (worker stopped?). It will be retried.', "
        "status_changed_at = time::now() "
        f"WHERE status IN ['queued', 'running'] AND status_changed_at < time::now() - {STALE_AFTER}"
    )


async def tick() -> int:
    if scheduler_forced_off():
        return 0
    settings = await IntegrationSettings.load_fresh()
    if not settings.scheduler_enabled:
        return 0
    await recover_stale()
    due = await repo_query(
        "SELECT id FROM sync_link WHERE sync_enabled = true "
        "AND status IN ['idle', 'error'] "
        "AND (next_sync_at = NONE OR next_sync_at <= time::now())"
    )
    queued = 0
    for row in due:
        try:
            if await enqueue_sync(str(row["id"])):
                queued += 1
        except Exception as e:
            logger.error(f"Failed to queue sync for {row['id']}: {e}")
    if queued:
        logger.info(f"Queued {queued} link sync(s)")
    return queued


async def run_forever() -> None:
    interval = max(int(os.environ.get(TICK_SECONDS_ENV, "60")), 5)
    if scheduler_forced_off():
        logger.info(f"Sync scheduler disabled by {ENABLE_ENV}; idling")
    else:
        logger.info(f"Sync scheduler started (tick every {interval}s)")
    while True:
        try:
            await tick()
        except Exception as e:
            # DB not up yet, transaction conflict, ...: keep going
            logger.warning(f"Sync scheduler tick failed: {e}")
        await asyncio.sleep(interval)


def main() -> None:
    from dotenv import load_dotenv

    load_dotenv()
    from open_notebook.utils.proxy import ensure_internal_no_proxy

    ensure_internal_no_proxy()
    asyncio.run(run_forever())


if __name__ == "__main__":
    main()
