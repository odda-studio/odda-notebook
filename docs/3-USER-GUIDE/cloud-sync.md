# Cloud Storage Sync - Dropbox and Google Drive

Connect a Dropbox or Google Drive account, pick **files and/or folders**, and Open Notebook imports them as sources — into one or more notebooks, or just into the general Sources list. Each item can be a one-time copy or **kept in sync**, and you can switch sync on or off at any time, per item and per file.

| What happens remotely | What happens in the notebook |
|---|---|
| A file is added | A new source is created and processed |
| A file is modified | **The same source** is updated: text, chunks, embeddings and insights are regenerated |
| A file is renamed | The source title follows (unless you edited it) |
| A file is deleted or moved out of the folder | **The source is deleted** |
| You delete a synced source yourself | It stays deleted, until the remote file changes again |

These rules apply to items **kept in sync**. A one-time copy is never touched automatically; *Sync now* refreshes it on demand.

Accounts and app credentials are configured in **Settings → Integrations**; importing happens from **Add Source → Cloud** or from Settings.

> **Deletions are automatic.** Deleting a file in Dropbox/Drive deletes its source (and its insights) in Open Notebook. If the whole folder disappears or access is revoked, the sync stops with an error and **nothing** is deleted.

---

## Requirements

- `OPEN_NOTEBOOK_ENCRYPTION_KEY` must be set (tokens and app secrets are encrypted at rest).
- The **worker** and the **sync scheduler** must be running. Docker images start both automatically; from source use `make start-all`, or `make worker-start` and `make scheduler-start`.
- The address you use to open Open Notebook in the browser (the **Public URL**), e.g. `http://localhost:3000` or `https://notebook.example.com`.

## 1. Set the Public URL

Settings → Integrations → **Sync settings** → *Public URL*. The provider redirects your browser back to this address after you authorize access, so it must be the frontend URL you actually use. Once set, each provider card shows its **redirect URI**:

```
<Public URL>/api/integrations/providers/dropbox/callback
<Public URL>/api/integrations/providers/google_drive/callback
```

## 2. Create an OAuth app (once per provider)

Each self-hosted instance uses its own app, so your data never goes through a third party.

### Dropbox

1. Open the [Dropbox App Console](https://www.dropbox.com/developers/apps) → **Create app**.
2. Choose **Scoped access** and **Full Dropbox** (or **App folder** if you only want to sync that folder).
3. In **Permissions**, enable `files.metadata.read`, `files.content.read`, `account_info.read` and `sharing.read` (to browse folders shared with you), then **Submit**. If you add a permission later, reconnect the account.
4. In **Settings → OAuth 2 → Redirect URIs**, add the redirect URI shown in Open Notebook.
5. Copy the **App key** and **App secret** into Settings → Integrations → Dropbox → *Configure app*.

### Google Drive

1. In [Google Cloud Console](https://console.cloud.google.com/), create (or select) a project and enable the **Google Drive API**.
2. Configure the **OAuth consent screen** and add the scope `https://www.googleapis.com/auth/drive.readonly`.
3. **Credentials → Create credentials → OAuth client ID → Web application**, and add the redirect URI shown in Open Notebook under *Authorized redirect URIs*.
4. Copy the **Client ID** and **Client secret** into Settings → Integrations → Google Drive → *Configure app*.

> **Refresh tokens expire after 7 days while the app is in "Testing".** For a sync that keeps working, either use a Google Workspace app with user type **Internal**, or **publish** the app (an unverified app works for your own account after a warning screen). Otherwise reconnect the account weekly.

Google Docs, Sheets and Slides are exported before import (default: Docs → DOCX, Sheets → XLSX, Slides → PPTX; change it in Sync settings). Forms, drawings and shortcuts are skipped.

## 3. Connect an account

On the provider card click **Connect account** and approve access.

## 4. Import files and folders

From **Add Source → Cloud** — on the Sources page (general sources) or inside a notebook — or from Settings → Integrations → *Linked items*:

1. Pick the account, browse, and tick any mix of **files and folders** (the selection is kept while you move between folders). Files that can't be imported (extension/size filters) are greyed out.
   - **Search:** the box above the list filters the open folder as you type (case and accents don't matter). With 2+ characters, **Search the whole account** finds files and folders by name anywhere in Drive/Dropbox, shows their path, and lets you tick them directly (opening a folder from the results browses into it).
   - **Shared items:** at the top level, Google Drive shows **Shared with me** and **Shared drives**, Dropbox shows **Shared with me** (folders shared with you, even those you haven't added to your Dropbox). These are groupings: open them and pick the folders or files inside. Shared folders you already added to your Dropbox also appear in the normal tree.
2. Choose the notebooks (none = general sources only; inside a notebook the current one is preselected).
3. Decide whether to **Keep in sync** (on by default), whether folders include subfolders, the sync interval and optional transformations.

The import starts immediately. Importing something that is already linked reuses it: the existing sources are added to the new notebooks, no duplicates are created.

## 5. Choose what stays in sync

| Level | Where | Effect |
|---|---|---|
| Linked item (file or folder) | Settings → Integrations → *Linked items* | Sync on/off, notebooks, subfolders, interval, transformations, *Sync now*, remove link (sources are kept) |
| Single file of a folder | expand a linked folder | **Sync off** freezes that source (never updated nor deleted); **Exclude** stops importing it (optionally deleting its source); **Include** undoes it |
| Source | source card badge and source detail → *Cloud sync* | same switch as above for that source: for a single-file link it toggles the link, for a file from a folder only that file; *Sync now*; open the original in Dropbox/Drive |

## Settings

| Setting | Where | Default |
|---|---|---|
| Keep in sync | per linked item, per file | on |
| Sync interval | per linked item (default in Sync settings) | 15 minutes (min 5) |
| Include subfolders | per linked folder | on |
| Transformations | per linked item | none |
| Automatic sync (scheduler) | Sync settings | on |
| Max file size | Sync settings | 100 MB |
| Allowed extensions | Sync settings | the formats Open Notebook can extract |
| Google export formats | Sync settings | DOCX / XLSX / PPTX |

Files excluded by the filters are listed as *unsupported* and never imported; changing a filter never deletes sources that were already imported. Whether the downloaded copy is kept after processing follows **Settings → Auto delete uploaded files**, like manual uploads.

## Environment variables (optional)

Anything set here overrides the UI and is shown read-only:

| Variable | Purpose |
|---|---|
| `DROPBOX_APP_KEY`, `DROPBOX_APP_SECRET` | Dropbox app credentials |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Google app credentials |
| `OPEN_NOTEBOOK_PUBLIC_URL` | Public URL used for OAuth redirects |
| `OPEN_NOTEBOOK_ENABLE_SYNC_SCHEDULER` | `false` turns automatic sync off (manual *Sync now* still works) |
| `OPEN_NOTEBOOK_SYNC_SCHEDULER_TICK_SECONDS` | How often the scheduler checks for due folders (default 60) |

Secrets also accept the `_FILE` suffix (e.g. `DROPBOX_APP_SECRET_FILE`) for Docker secrets.

## Troubleshooting

- **"redirect_uri mismatch"** — the URI registered in the provider console must match the one shown in Open Notebook exactly (scheme, host, port, path).
- **Item stays "queued"** — the worker isn't running. Items stuck for over an hour are released and retried.
- **Nothing syncs automatically** — check that the scheduler is running (`make status`) and enabled in Sync settings.
- **"Remote folder … not found"** — the folder was deleted, moved, or access was revoked. Reconnect the account or remove the link; no sources were deleted. (For a single linked **file**, a missing file counts as deleted and its source is removed.)
- **Google stops working after a week** — see the "Testing" note above.
