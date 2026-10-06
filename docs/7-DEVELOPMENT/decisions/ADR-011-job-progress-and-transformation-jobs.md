# ADR-011: Background jobs report live progress; ingestion transformations are separate jobs

- **Status**: Accepted
- **Date**: 2026-10
- **Related**: [ADR-004](ADR-004-background-workers.md) (background workers), [ADR-006](ADR-006-migration-granularity.md), [ADR-009](ADR-009-cloud-storage-sync.md) (cloud sync)

## Context

The Activity page lists surreal-commands jobs, can stop them (cooperative cancellation, migration 30) and shows timings (migration 29). Users asked to see *what each job is doing right now*, to stop processing individually or in bulk, and to see every transformation in progress. Two gaps blocked that: surreal-commands records only status/result, so a running job was a black box; and transformations chosen at upload ran *inside* the `process_source` job (a LangGraph `Send` fan-out), so they were invisible and could only be stopped together with the extraction — a failing one also failed and re-ran the whole extraction.

## Decision

- **Progress lives on the `command` row** (migration 32): `progress` (current step: code, detail, current/total, time), `progress_log` (one entry per step change, last 50) and `attempts`. The worker writes it through `open_notebook/utils/job_progress.py`: the `cancellable` wrapper binds the command id to a context variable, so any code running in the job — commands, graph nodes, `generate_embeddings` — calls `report_progress(step, detail, current, total)` without threading the id. Outside a job it is a no-op; writes are best effort and counter updates of the same step are throttled to one per second.
- **Steps are stable codes** translated by the frontend (`activity.steps.<step>`); details are free text (file name, model, counts).
- **Third-party graphs** we can't edit (podcast-creator) report through a LangChain configure hook (`graph_node_steps`) that maps LangGraph node starts to steps.
- **Ingestion queues one `run_transformation` job per transformation** after the source is saved, instead of running them inside `process_source`. `run_transformation` now fails the job (re-raises) on permanent errors instead of completing with `success=False`.
- **Bulk stop** is one endpoint with exactly one selector (`job_ids`, `stage`, `all`); the job detail endpoint returns input/output with long texts truncated.
- The Activity UI polls (2 s list, 1 s for an open job detail) rather than streaming: one more poller is cheap and keeps the API stateless.

## Alternatives considered

- **SSE/WebSocket push of progress** — rejected for now: needs a pub/sub path from the worker process to the API; polling a row is enough at these rates.
- **A separate `job_progress` table** — rejected: one row per job already exists and is what the Activity view reads; a separate table adds joins and cleanup.
- **Keep transformations inside `process_source` and report sub-steps** — rejected: sub-steps still couldn't be stopped individually and a failure would still re-run extraction.

## Consequences

- A source is "completed" as soon as its text is saved; its transformations (and insights) arrive later as separate jobs, visible on the Activity page.
- One extra DB write per step (and at most one per second per counter) per running job.
- New long-running code should call `report_progress` at meaningful steps; new step codes need an `activity.steps.*` key in every locale (unknown codes are shown raw).
- Progress is recorded only for jobs started after migration 32.
