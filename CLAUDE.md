# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Is

A multi-tenant FastAPI web app deployed on Dokploy (Docker Swarm + Traefik) at `http://130.110.6.169`. Restaurant operators register an account, configure iPratico POS credentials and a WhatsApp number via Green API, then receive automated daily sales reports on WhatsApp on a per-user cron schedule.

## Running Locally

```bash
pip install -r requirements.txt

# Requires a running PostgreSQL instance and env vars:
export DATABASE_URL="postgresql+asyncpg://user:pass@localhost/ipratico_reporter"
export SECRET_KEY="<64-char hex string>"  # used for both JWT signing and Fernet encryption

alembic upgrade head
uvicorn app.main:app --reload --port 8000
```

There are no tests. There is no linter config. No build step for the frontend (vanilla JS/HTML/CSS in `app/static/`).

## DB Migrations

```bash
# Create a new migration after model changes
alembic revision --autogenerate -m "describe change"

# Apply migrations (also runs automatically at container startup via Dockerfile CMD)
alembic upgrade head
```

## Deployment

Push to `main` → GitHub webhook → Dokploy rebuilds and redeploys the Docker service automatically. The Dockerfile runs `alembic upgrade head` before starting uvicorn, so migrations are applied on every deploy.

SSH access: `ssh -i Dokploy_private_id_rsa.txt root@130.110.6.169`

## Architecture

### Request flow
```
Browser → Traefik (port 80) → FastAPI container (port 8000 internal)
                                    ├── /auth/*         → auth.py (JWT)
                                    ├── /api/settings   → settings_routes.py
                                    ├── /api/whatsapp/* → whatsapp_routes.py
                                    ├── /api/report/*   → settings_routes.py → reporter.py
                                    └── /*              → StaticFiles (app/static/)
```

### Key design decisions

**Encryption**: `app/crypto.py` wraps Fernet. Both the JWT secret and the Fernet key are derived from the same `SECRET_KEY` env var (64-char hex). All sensitive fields in `user_settings` (`ipratico_password_enc`, `greenapi_api_token_enc`) are stored Fernet-encrypted; the API never returns plaintext — only `has_*` boolean flags.

**Scheduler**: `AsyncIOScheduler` (not `BackgroundScheduler`) runs on the same event loop as FastAPI/uvicorn. This is essential — `BackgroundScheduler` runs jobs in threads and `asyncio.run()` creates a new event loop that conflicts with the `asyncpg` connection pool. Jobs call `_run_report_async()` directly.

**iPratico auth**: The iPratico API uses a session-based token (`window.idUsr`) extracted from HTML after a form POST login. The token rotates; `ipratico.py` re-authenticates on 401. All calls to iPratico share a single `httpx.AsyncClient` per report run.

**Green API**: Each user's WhatsApp instance is identified by `greenapi_id_instance` + `greenapi_api_token_enc` + `greenapi_api_url`. All Green API calls go through `_green_api_get()` in `whatsapp_routes.py` which constructs URLs as `{api_url}/waInstance{id}/{method}/{token}`. The `greenapi_api_url` can differ per instance — always use `settings.greenapi_api_url`, never hardcode a host.

**Frontend SPA**: Single HTML file with vanilla JS. Navigation is class-based (`page.active { display: flex }`). The `.hidden` utility class uses `!important` — never add `hidden` to page `<div>` elements since it overrides the `active` class. All API calls go through the `api(method, path, body)` helper which handles auth headers and throws on non-OK responses.

### Report logic (`reporter.py`)

`run_report()` sends three message types in sequence, all within one shared iPratico session:
1. **Daily**: yesterday's total sales
2. **Month-to-date**: current month vs same period last year (YoY %)
3. **Month-closed** (1st of month only): full prior month vs same month last year

`preview_report()` is identical but skips the WhatsApp send.

### Settings flow

`GET /api/settings` returns a `SettingsOut` that redacts secrets to boolean flags (`has_ipratico_password`, `has_greenapi_token`). `PUT /api/settings` accepts partial updates — only non-None fields are written. After any settings save, `sync_user_job()` is called to add/remove/update the user's APScheduler job immediately.

## Required Env Vars

| Var | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string (asyncpg driver) |
| `SECRET_KEY` | 64-char hex: used for JWT signing and Fernet encryption of stored credentials |
| `GREENAPI_PARTNER_TOKEN` | Optional `gac.` token; if set, `POST /api/whatsapp/setup` auto-creates instances |

## bcrypt Version Pin

`bcrypt` is pinned to `<4.0.0` in `requirements.txt`. passlib 1.7.4 is incompatible with bcrypt 4.x (`module 'bcrypt' has no attribute '__about__'`). Do not remove this pin.
