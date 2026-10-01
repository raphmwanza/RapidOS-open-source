# Deploying RapidOS on Railway

RapidOS runs on Railway as four services in one project and environment:

| Service | What it is | Source |
| --- | --- | --- |
| `rapidos` | Go API (WhatsApp webhook, AI replies, internal routes) | this repository, root directory `/backend` |
| `dashboard` | Next.js dashboard, marketing site and docs | this repository, repository root |
| `Postgres` | Railway PostgreSQL template | Railway |
| `Redis` | Railway Redis template | Railway |

The API service is called `rapidos` below because that is its name in the existing
project. If yours is called something else (for example `api`), use that name in the
`${{...}}` references.

Both images are built from the Dockerfiles in this repository, exactly as
`docker compose` and CI build them. Nothing needs a database, Redis or any secret at
build time: every variable below is read when the container starts, including the
`NEXT_PUBLIC_*` URLs (see `lib/runtimeEnv.ts`).

## Service settings

### API (`rapidos`)

| Setting | Value |
| --- | --- |
| Source | GitHub repo, branch you deploy (e.g. `prod`) |
| Root directory | `/backend` |
| Railway config file | `/backend/railway.json` (absolute path: the config file does not follow the root directory) |
| Builder | Dockerfile (`backend/Dockerfile`, set by `backend/railway.json`) |
| Healthcheck | `/health` (set by `backend/railway.json`) |
| Public domain | your API domain, target port `8080` |
| Wait for CI | on, once GitHub Actions can run for the repository |

### Dashboard (`dashboard`)

| Setting | Value |
| --- | --- |
| Source | GitHub repo, same branch as the API |
| Root directory | empty (repository root: the image needs `package.json`, `prisma/`, `app/` ...) |
| Railway config file | `/frontend/railway.json` |
| Builder | Dockerfile (`frontend/Dockerfile`, set by `frontend/railway.json`) |
| Pre-deploy command | `npx prisma migrate deploy` (set by `frontend/railway.json`) |
| Healthcheck | `/api/health` (set by `frontend/railway.json`) |
| Volume | mount one at `/app/storage` (claim documents, WhatsApp media, claim PDFs) |
| Public domain | your dashboard domain, target port `3000` |

`railway.json` is Railway's *Config as Code*. Railway has deprecated it in favour of
*Infrastructure as Code* (`.railway/railway.ts`): existing services keep reading the
file until 2026-12-01, and new services cannot opt in. If Railway does not pick the
file up, enter the same values in the service settings by hand, or run
`railway config migrate` (it converts every `railway.json` in the repository into one
`.railway/railway.ts`).

## Variables

Put the secrets that both services need in **shared variables** of the environment
(Project settings, Shared Variables) and reference them with `${{shared.NAME}}`, so the
two services can never disagree:

| Shared variable | How to create it |
| --- | --- |
| `JWT_ACCESS_SECRET` | `openssl rand -hex 32` |
| `JWT_REFRESH_SECRET` | `openssl rand -hex 32` (different from the access secret) |
| `ENCRYPTION_KEY` | `openssl rand -base64 32`. Never change it afterwards: saved WhatsApp tokens and AI keys could no longer be decrypted. |
| `INTERNAL_API_KEY` | `openssl rand -hex 32` |

### API (`rapidos`)

| Variable | Value | Required |
| --- | --- | --- |
| `PORT` | `8080` (matches the domain's target port; Railway also health-checks this port) | yes |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | yes |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | yes |
| `JWT_ACCESS_SECRET` | `${{shared.JWT_ACCESS_SECRET}}` | yes, the API exits without it |
| `JWT_REFRESH_SECRET` | `${{shared.JWT_REFRESH_SECRET}}` | yes, the API exits without it |
| `ENCRYPTION_KEY` | `${{shared.ENCRYPTION_KEY}}` | yes for saved per-company WhatsApp/AI settings |
| `INTERNAL_API_KEY` | `${{shared.INTERNAL_API_KEY}}` | yes (without it the internal routes are unprotected) |
| `FRONTEND_BASE_URL` | `http://${{dashboard.RAILWAY_PRIVATE_DOMAIN}}:3000` | yes (claim creation calls the dashboard) |
| `CORS_ALLOWED_ORIGINS` | `https://${{dashboard.RAILWAY_PUBLIC_DOMAIN}}` or your dashboard origin (comma-separated) | recommended |
| `JWT_ACCESS_EXPIRES` / `JWT_REFRESH_EXPIRES` | `15m` / `168h` | optional |
| `BCRYPT_COST` | `12` | optional |
| `RATE_LIMIT_REQUESTS` / `RATE_LIMIT_WINDOW` | `100` / `60` | optional |
| `LOG_LEVEL` | `info` | optional |
| `LLM_PROVIDER`, `LLM_API_KEY`, `LLM_MODEL`, `LLM_BASE_URL`, `LLM_TIMEOUT` | fallback AI provider; each company normally sets its own in Settings | optional |
| `GOOGLE_API_KEY`, `GEMINI_MODEL`, `GEMINI_TIMEOUT` | legacy names, still read when `LLM_*` is empty | optional |
| `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_APP_SECRET`, `WHATSAPP_WEBHOOK_URL` | single-tenant fallbacks; each company normally sets its own in Settings | optional |
| `WHATSAPP_GRAPH_API_BASE` | empty (`https://graph.facebook.com/v18.0`) | optional |

Do not set `API_PORT` on Railway (it is the docker-compose setting and would only be
used when `PORT` is missing) and never set `DB_AUTO_MIGRATE=true`: Prisma migrations
own the schema.

### Dashboard (`dashboard`)

| Variable | Value | Required |
| --- | --- | --- |
| `PORT` | `3000` (matches the domain's target port) | yes |
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` | yes |
| `DIRECT_DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (Prisma `directUrl`, used by `migrate deploy`) | yes |
| `REDIS_URL` | `${{Redis.REDIS_URL}}` | yes |
| `BACKEND_URL` | `http://${{rapidos.RAILWAY_PRIVATE_DOMAIN}}:8080` | yes |
| `NEXT_PUBLIC_BASE_URL` | `https://${{dashboard.RAILWAY_PUBLIC_DOMAIN}}` or your dashboard URL | yes (PDF links sent on WhatsApp, canonical URLs) |
| `NEXT_PUBLIC_APP_URL` | same as `NEXT_PUBLIC_BASE_URL` | recommended (CORS) |
| `NEXT_PUBLIC_API_URL` | public URL of the API, e.g. `https://rapidos243.com` | recommended |
| `PUBLIC_API_URL` | same; the webhook URL shown in Settings, WhatsApp is `<this>/api/v1/whatsapp/webhook` | recommended |
| `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET` | `${{shared.JWT_ACCESS_SECRET}}` / `${{shared.JWT_REFRESH_SECRET}}` | yes |
| `ENCRYPTION_KEY` | `${{shared.ENCRYPTION_KEY}}` | yes |
| `INTERNAL_API_KEY` | `${{shared.INTERNAL_API_KEY}}` | yes |
| `FILE_STORAGE_DIR` | `/app/storage` (the volume's mount path) | yes |
| `PDF_FONT_DIR` | `/usr/share/fonts/truetype/dejavu` | recommended (accents and non-Latin scripts in claim PDFs) |
| `RAILWAY_RUN_UID` | `0` | yes with a volume: Railway mounts volumes as root, the image runs as `node` |
| `TRUSTED_PROXY` | `1` behind Railway's edge only, `2` when Cloudflare proxies the domain in front of Railway | recommended, otherwise every client shares one rate-limit bucket |
| `JWT_EXPIRES_IN` / `JWT_REFRESH_EXPIRES_IN` | `900` / `604800` | optional |
| `SIGNUP_RATE_LIMIT_PER_HOUR`, `CONTACT_RATE_LIMIT_PER_HOUR`, `LOGIN_MAX_FAILURES`, `LOGIN_LOCKOUT_MINUTES`, `LOG_LEVEL` | see `.env.example` | optional |

Variables from older RapidOS versions that are no longer read and can be deleted from the
API service: `ALLOWED_DOMAINS` (replaced by `CORS_ALLOWED_ORIGINS`), `BACKEND_API_KEY`,
`NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_BASE_URL` (the API never read them; they belong on
the dashboard).

## Database

The dashboard's pre-deploy command, `npx prisma migrate deploy`, creates the schema on
an empty database and applies new migrations on every deploy. It runs inside the built
dashboard image with the service variables, before the new version receives traffic,
and a failing migration stops the deploy. Deploy the dashboard before (or together
with) the API on a fresh database; the API connects at startup but only queries the
tables when requests arrive.

The migrations expect an **empty** database (or one created by these same migrations).
They are not meant to be applied on top of a schema from another version.

To start over with an empty database (this deletes all data; take a dump first):

```bash
# Back up (DATABASE_PUBLIC_URL is on the Postgres service; it needs the TCP proxy,
# or run the commands from `railway connect Postgres`).
pg_dump "$DATABASE_PUBLIC_URL" --no-owner --format=custom -f rapidos-before-reset.dump

# Empty the database
psql "$DATABASE_PUBLIC_URL" -v ON_ERROR_STOP=1 <<'SQL'
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO CURRENT_USER;
GRANT ALL ON SCHEMA public TO public;
SQL

# Then redeploy the dashboard (the pre-deploy command migrates), or run it by hand
# from a checkout of the same commit:
DATABASE_URL="$DATABASE_PUBLIC_URL" DIRECT_DATABASE_URL="$DATABASE_PUBLIC_URL" npx prisma migrate deploy
```

Afterwards open the dashboard and create the first company on `/signup`.

## CI and deploys

With "Wait for CI" on, Railway only deploys a commit after the GitHub Actions workflow
(`.github/workflows/docker-image.yml`) has passed on it. The workflow runs on `main`,
`prod` and `railway-ready`, so both the API and the dashboard image are built and tested
before Railway builds them again.
