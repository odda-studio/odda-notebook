# ADR-009: Cloud-storage sync uses thin in-repo connectors, polling, and a separate scheduler process

- **Status**: Accepted
- **Date**: 2026-09
- **Related**: [ADR-002](ADR-002-external-libraries.md) (external libraries), [ADR-004](ADR-004-background-workers.md) (background workers), [ADR-006](ADR-006-migration-granularity.md), [PDR-001](PDR-001-single-user-first.md), [Cloud Storage Sync](../../3-USER-GUIDE/cloud-sync.md)

## Context

Users want documents that live in Dropbox or Google Drive to be available as sources without importing them by hand, and to stay current when the files change. VISION.md says Open Notebook is *not* a file storage system, and ADR-002 pushes heavy platform integrations into external libraries. The feature has to work on self-hosted instances that are often not reachable from the internet, and nothing in the stack could run periodic jobs (surreal-commands has no scheduling).

## Decision

- **Import, don't mirror storage.** A *link* is a remote folder or single file imported into 0..N notebooks (none = general sources); each remote file becomes an ordinary source. A link with sync off is a one-time copy that remembers its origin; sync can be switched on later, per link and per file (a file with sync off is frozen: never updated nor deleted). Importing an already linked item reuses its sources. Changed files update the **same** source in place (file replaced atomically, insights cleared, `process_source` re-run, chunks re-embedded); files deleted remotely delete their source; a source the user deletes is remembered as `ignored` and only comes back if the remote file changes.
- **Thin connectors in this repo** (`open_notebook/integrations/`): plain `httpx` calls behind a `StorageProvider` interface (authorize, refresh, list, download). No vendor SDKs, so the footprint stays small; the interface is the seam for moving connectors into an external library later if they grow.
- **Polling, not webhooks.** Each sync lists the folder and diffs it against the `synced_file` table (`plan_sync`, a pure function). Works behind NAT and needs no public endpoint beyond the OAuth redirect.
- **A separate scheduler process** (`python -m open_notebook.integrations.scheduler`) only queues `sync_link` commands for links with sync on when `next_sync_at` passes; the worker does the work (ADR-004). Queueing is a conditional `UPDATE`, so restarts or extra instances never double-queue.
- **Configurable from the UI**, env vars as override: OAuth app credentials (encrypted with `OPEN_NOTEBOOK_ENCRYPTION_KEY`), public URL, scheduler switch, filters. Env-managed values are shown read-only.
- **Safety over completeness on deletion:** if a linked folder is missing, inaccessible or the token is revoked, the run aborts before computing removals. Extension/size filters never delete already imported sources.

## Alternatives considered

- **External library now** (ADR-002 default) — deferred: two connectors are a few hundred lines of HTTP; the interface keeps the option open.
- **Vendor SDKs** (`dropbox`, `google-api-python-client`) — rejected: large dependency trees for a handful of endpoints.
- **Webhooks / push notifications** — rejected for v1: require a public HTTPS endpoint and per-provider channel renewal; polling covers the self-hosted case. Delta cursors (`list_folder/continue`, `changes.list`) are the next optimisation.
- **Scheduler inside the API lifespan** — rejected: runs once per API process and ADR-004 rejects in-process asyncio jobs.
- **Delete-and-recreate on change** — rejected: breaks chat/context references and notebook links.

## Consequences

- One more long-running process (Makefile `scheduler-start`, supervisord `[program:scheduler]`).
- Full folder listing per run (single-file links cost one metadata call): fine for hundreds of files, costly for very large trees until delta cursors land.
- Google `drive.readonly` is a restricted scope: apps left in "Testing" get refresh tokens that expire after 7 days (documented).
- The OAuth callback paths are the only unauthenticated `/api/integrations` routes; they are protected by an HMAC-signed, expiring `state`.
- Data model is single-user; accounts and links can gain an owner field later without reshaping (PDR-001).
