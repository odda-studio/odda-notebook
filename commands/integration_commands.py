"""Cloud-storage sync command (Dropbox / Google Drive files and folders -> sources)."""

import time
from typing import List, Optional

from loguru import logger
from surreal_commands import CommandInput, CommandOutput, command

from open_notebook.integrations.sync import run_sync
from open_notebook.utils.job_cancellation import cancellable


class SyncLinkInput(CommandInput):
    link_id: str


class SyncLinkOutput(CommandOutput):
    success: bool
    link_id: str
    created: int = 0
    updated: int = 0
    renamed: int = 0
    deleted: int = 0
    unsupported: int = 0
    deferred: int = 0
    failed: int = 0
    errors: List[str] = []
    skipped_reason: Optional[str] = None
    processing_time: float


@command(
    "sync_link",
    app="open_notebook",
    retry={
        # Transient failures (network, provider 5xx, DB conflicts). Account or
        # link problems are recorded on the link and not retried.
        "max_attempts": 3,
        "wait_strategy": "exponential_jitter",
        "wait_min": 5,
        "wait_max": 120,
        "stop_on": [ValueError],
        "retry_log_level": "debug",
    },
)
@cancellable
async def sync_link_command(input_data: SyncLinkInput) -> SyncLinkOutput:
    start = time.time()
    result = await run_sync(input_data.link_id)
    if result.skipped_reason:
        logger.info(f"Sync {input_data.link_id} skipped: {result.skipped_reason}")
    return SyncLinkOutput(
        success=not result.skipped_reason and not result.failed,
        link_id=input_data.link_id,
        created=result.created,
        updated=result.updated,
        renamed=result.renamed,
        deleted=result.deleted,
        unsupported=result.unsupported,
        deferred=result.deferred,
        failed=result.failed,
        errors=result.errors,
        skipped_reason=result.skipped_reason,
        processing_time=time.time() - start,
    )
