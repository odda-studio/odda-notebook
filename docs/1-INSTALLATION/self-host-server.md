# Self-host on Your Own Server (this fork)

Run the whole app (frontend, API, worker, SurrealDB) on a Linux server with a domain and automatic HTTPS.

The standard [Docker Compose](docker-compose.md) guide pulls the upstream `lfnovo/open_notebook` image, which does **not** include this fork's features (cloud sync, website widget, …). `docker-compose.prod.yml` builds the image from this repository instead and puts [Caddy](https://caddyserver.com) in front for HTTPS.

```
Internet → Caddy :443 → open_notebook :8502 (Next.js) → :5055 (FastAPI, same container) → surrealdb :8000
```

Only ports 80 and 443 are published. The API and the database are reachable only on the internal Docker network.

---

## Requirements

- Linux server (Ubuntu/Debian), 4 GB RAM or more (the frontend build needs it), 20 GB disk
- A domain with an A/AAAA record pointing at the server
- Docker Engine with the compose plugin
- Firewall open on 22, 80, 443 only

## 1. Get the code

```bash
git clone git@github.com:odda-studio/odda-notebook.git
cd odda-notebook
git checkout main   # or the release tag you want to deploy
```

## 2. Configure

```bash
cp .env.production.example .env
```

Fill in at least:

| Variable | Value |
|---|---|
| `DOMAIN`, `ACME_EMAIL` | Your hostname and an email for Let's Encrypt |
| `API_URL`, `OPEN_NOTEBOOK_PUBLIC_URL` | `https://<DOMAIN>` (no `/api`) |
| `OPEN_NOTEBOOK_ENCRYPTION_KEY` | `openssl rand -base64 32` — back it up separately; if lost, stored AI credentials become unreadable |
| `OPEN_NOTEBOOK_PASSWORD` | Strong password — without it auth is disabled |
| `SURREAL_PASSWORD` | Real database password |

Never enable `OPEN_NOTEBOOK_AI_DEBUG` in production: it logs prompts and answers.

## 3. Start

```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml logs -f open_notebook
```

Wait for the migrations and the worker to start, then open `https://<DOMAIN>`, log in and configure your models in **Manage → Models**.

For cloud sync, register the redirect URI shown in the UI in the Dropbox / Google console (see [Cloud Sync](../3-USER-GUIDE/cloud-sync.md)).

## 4. Check

```bash
docker compose -f docker-compose.prod.yml ps        # 3 services running
curl -s https://<DOMAIN>/api/config                  # JSON with version and db status
nc -zv <server-ip> 5055; nc -zv <server-ip> 8000     # from outside: both must fail
```

Then create a notebook, add a source (it must finish embedding — that proves the worker runs) and ask a question in chat.

## Updating

```bash
git pull
docker compose -f docker-compose.prod.yml up -d --build
```

Migrations run automatically on startup.

## Backups

Back up `surreal_data/` and `notebook_data/` regularly (e.g. a nightly cron with `tar` + `restic`/`rsync` off-site). For a consistent copy, stop the stack first or export the database with `surreal export`. Keep the encryption key outside the backup.

## Security notes

- Auth is a single shared password and CORS is open: fine for a small team, not a hardened multi-tenant setup. For internal-only use, consider restricting access further (VPN, IP allowlist in Caddy). The [website widget](../3-USER-GUIDE/website-widget.md) needs `/api/widget/*` reachable publicly.
- Uploads are capped by `OPEN_NOTEBOOK_MAX_UPLOAD_SIZE_MB` (default 100); keep `request_body max_size` in the `Caddyfile` above it.
- See [Security](../5-CONFIGURATION/security.md) and [Reverse Proxy](../5-CONFIGURATION/reverse-proxy.md) for more.
