# RapidOS

RapidOS is a self-hosted, multi-tenant WhatsApp insurance-claims assistant with a Go API, Next.js dashboard, PostgreSQL, Redis, and configurable LLM providers.

## Run locally

1. Copy `.env.example` to `.env` and replace every placeholder. Generate `ENCRYPTION_KEY` with `openssl rand -base64 32`.
2. Run `docker compose up --build`.
3. Visit `http://localhost:3000/signup` (or click **Create account** on the home page) to create a company.
   The wizard asks for company and contact details, the coverage types you offer (seeded with default required
   information and documents), assistant on/off switches and the assistant and dashboard language (15 languages, see [Languages](#languages)).
   No password is chosen: the server generates the super-admin password (a UUID) and shows it **once** on the
   success screen. Signups are rate-limited per IP (`SIGNUP_RATE_LIMIT_PER_HOUR`, default 5).
4. In **Settings > WhatsApp integration** (admins only), enter the phone number ID, business account ID,
   access token, app secret and a webhook verify token (type one or click **Generate new**). Secrets are stored
   encrypted and shown masked; leaving a secret blank keeps it. The verify token can be revealed and copied,
   because it has to be pasted into Meta. Set the **Public API base URL** (e.g. your ngrok HTTPS address) and
   copy the resulting callback URL `<base>/api/v1/whatsapp/webhook`; **Test webhook** runs Meta's verification
   handshake against the API with the saved token.
5. In **Users** (admins only), add teammates. Each new user gets a generated password (a UUID) that is shown
   once. Roles: **Super admin** (everything, incl. other super admins), **Admin** (settings, integrations,
   users except super admins), **Moderator** (agent work + archive conversations / delete customers),
   **Agent** (conversations, customers, claims, documents) and **Viewer** (read-only). Admins can edit roles,
   deactivate/reactivate accounts and reset passwords; the last active super admin can never be demoted or
   deactivated. Access is decided by the role alone (`lib/users/roles.ts`); the legacy `admin_permissions`
   table is unused. Resetting a password or deactivating an account signs that user out everywhere at once:
   every token carries the account's `token_version`, which the reset bumps, so the old session gets `401`
   on its next request. Viewers never see create/edit/delete controls, and the API rejects their writes.
   There is no public self-registration: accounts come only from `/signup` (a new company and its super
   admin) and the **Users** page. Emails are case-insensitive (stored lowercased).

The Go API serves Meta's webhook at the fixed path `/api/v1/whatsapp/webhook` and matches the GET challenge
against each company's saved verify token, so a token change takes effect immediately.

## Run locally with Docker

Requires Docker Desktop (or Docker Engine with Compose v2).

1. Create your local env file and fill in the secrets (`.env` is gitignored):
   ```bash
   cp .env.example .env        # PowerShell: Copy-Item .env.example .env
   ```
   Use long random values for `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `JWT_ACCESS_SECRET`,
   `JWT_REFRESH_SECRET` and `INTERNAL_API_KEY` (`openssl rand -hex 32`), and a base64 32-byte key for
   `ENCRYPTION_KEY` (`openssl rand -base64 32`). LLM and WhatsApp keys can stay blank; they are entered
   per company in **Settings**.
2. Start the stack:
   ```bash
   docker compose up -d --build
   docker compose ps            # postgres, redis, api, dashboard should be "healthy"
   ```
   The one-shot `migrate` service runs `prisma migrate deploy` before the API and dashboard start.
   There is no demo seed; `/signup` creates a company, its super-admin and default data.
3. Open:
   - Dashboard: http://localhost:3000 (create a company at http://localhost:3000/signup)
   - Backend API health: http://localhost:8080/health
   - Postgres `localhost:5432`, Redis `localhost:6379` (bound to 127.0.0.1 only)
   - Optional Adminer: `docker compose --profile tools up -d adminer` then http://localhost:8081
4. Useful commands:
   ```bash
   docker compose logs -f api dashboard   # follow logs
   docker compose down                    # stop (data is kept)
   docker compose down -v                 # stop and wipe the database/redis volumes (full reset)
   ```

**LLM per company:** each company picks its model in **Settings > Integrations** (Gemini, OpenAI,
DeepSeek, Qwen or any OpenAI-compatible server such as Ollama or vLLM). No global `LLM_API_KEY` is
needed; the `LLM_*` variables are only a fallback for companies that saved no LLM settings. Changes take
effect on the next message (the client is rebuilt when the settings change).
- `LLM_TIMEOUT` (seconds, default `90`) bounds every LLM request. Raise it for large local models on
  slow hardware.
- **Ollama:** use the provider "OpenAI-compatible" with base URL `http://host.docker.internal:11434/v1`
  (from the containers) and any API key value. Ollama unloads an idle model after 5 minutes, so the next
  customer waits for a cold load (10-30 s for 7-14B models). Set `OLLAMA_KEEP_ALIVE` on the machine
  running Ollama (for example `OLLAMA_KEEP_ALIVE=24h`, or `-1` to keep it loaded forever) and restart
  Ollama to keep the model in memory.

**Testing WhatsApp:** Meta must reach the backend over a public HTTPS URL. Run e.g. `ngrok http 8080`,
paste its `https://` address into **Settings > WhatsApp integration > Public API base URL** (or set
`PUBLIC_API_URL` in `.env` as the default for every company), save, then copy the callback URL and verify
token from that card into the Meta developer app (WhatsApp > Configuration > Webhook > Edit) and subscribe
to the `messages` field. Use Meta's free test phone number and add your own number as a test recipient.

**Claim documents and PDFs:** uploaded files, WhatsApp photos/documents and generated claim PDFs are
stored on disk under `FILE_STORAGE_DIR` (`/app/storage`, the `dashboard_files` Docker volume), in
`companies/<companyId>/claims/<claimId>/`. Every read checks the company of the signed-in admin. Back up
that volume together with the database (`docker compose down -v` deletes it).
- A claim report PDF is generated when a claim is created, when its status changes (plus a status summary
  PDF) and when documents are added. It is linked on the claim (**Download PDF** on the claim page) and
  served at `/api/claims/<claimNumber>/pdf` (`?download=1`, `?regenerate=1`, `?lang=fr`).
- PDFs use the company name, contact details, primary colour and logo (Settings > Company; PNG or JPEG,
  data URL, `/public` path or a public `https` URL up to 1 MB; private-network URLs are refused unless
  `PDF_LOGO_ALLOW_PRIVATE=true`).
- The language is the one the customer used with the WhatsApp assistant (stored on the claim), else the
  company's bot language. PDF texts exist in English, French, Spanish, Portuguese and Swahili; other
  languages get an English PDF. The DejaVu Sans font (`PDF_FONT_DIR`) renders accents, Greek, Cyrillic
  and Vietnamese; Amharic, Hindi and Bengali are not covered by it and fall back to English.
- The WhatsApp assistant saves media through `POST /api/media/upload` with the internal API key and the
  company id (`X-Internal-API-Key`, `X-Company-ID`); the customer must belong to that company. Media sent
  while a claim is being filed is kept and attached when the claim is created.
- `WHATSAPP_GRAPH_API_BASE` overrides the Meta Graph API base (default `https://graph.facebook.com/v18.0`),
  e.g. to point at a mock server in tests.

## Public site

The home page (`/`), the documentation (`/docs`, including the API reference at `/docs/api`) `/pricing` and `/contact` are
public pages for visitors. They are written in **English only**, on purpose: they use no i18n dictionary and no
language switcher, keep `lang="en"` and leave browser auto-translation enabled. The dashboard keeps its 15 languages.
- Site name, description, GitHub link and canonical URL: `config/site.ts` (the URL comes from `NEXT_PUBLIC_BASE_URL`).
- Plans (Free self-hosted, and Contact us for hosting, enterprise, setup and support) and the FAQ: `config/pricing.ts`. No prices are published
  and no payment provider is connected.
- Contact form `/contact`: submissions are stored in the `contact_requests` table (no e-mail is sent). The contact address
  is `contactEmail` in `config/site.ts`.
- API reference data: `lib/marketing/api/` (written from the route code; `__tests__/unit/apiReference.test.ts` fails when a
  route is added or removed without updating it).
- Screenshots: `public/screenshots/` (taken from a demo company with fictional data), listed in `lib/marketing/screenshots.ts`.

## Languages

The dashboard and the WhatsApp assistant support 15 languages. Each company picks a dashboard language and an
assistant language (at signup or in **Settings > Language**), and each user can override the dashboard
language for themselves. Arabic is right-to-left: the page gets `dir="rtl"` and the layout is mirrored.

| Code | Language | Native name | Dir | Main regions | Status |
|------|----------|-------------|-----|--------------|--------|
| `en` | English | English | ltr | — | Reviewed (source language) |
| `fr` | French | Français | ltr | DRC, West and Central Africa, France | Reviewed |
| `pt` | Portuguese | Português | ltr | Angola, Mozambique, Brazil | Machine-translated, **community review needed** |
| `es` | Spanish | Español | ltr | Latin America | Machine-translated, **community review needed** |
| `ar` | Arabic | العربية | **rtl** | North Africa, Middle East | Machine-translated, **community review needed** |
| `sw` | Swahili | Kiswahili | ltr | Kenya, Tanzania, Uganda, eastern DRC | Machine-translated, **community review needed** |
| `vi` | Vietnamese | Tiếng Việt | ltr | Vietnam | Machine-translated, **community review needed** |
| `id` | Indonesian | Bahasa Indonesia | ltr | Indonesia | Machine-translated, **community review needed** |
| `hi` | Hindi | हिन्दी | ltr | India | Machine-translated, **community review needed** |
| `bn` | Bengali | বাংলা | ltr | Bangladesh, India | Machine-translated, **community review needed** |
| `tl` | Filipino | Filipino | ltr | Philippines | Machine-translated, **community review needed** |
| `am` | Amharic | አማርኛ | ltr | Ethiopia | Machine-translated, **community review needed** |
| `ha` | Hausa | Hausa | ltr | Nigeria, Niger, Ghana | Machine-translated, **community review needed** |
| `yo` | Yoruba | Yorùbá | ltr | Nigeria, Benin | Machine-translated, **community review needed** |
| `ln` | Lingala | Lingála | ltr | DRC, Republic of the Congo | Machine-translated, **community review needed** |

**Coverage.** English and French are complete. The other locales cover the core screens: sign-in, signup,
home, navigation, the claims, customers, conversations and analysis lists, and the main Settings sections.
Any missing string falls back to English. Run `npm run check:locales` to see the current coverage per locale.
The WhatsApp status-update messages and the assistant's built-in replies are translated for all 15 languages.
Machine-translated locales are marked as such in the language pickers until a native speaker reviews them.

**Assistant language.** English and French have full, hand-written default prompts. Every other language uses
the English base prompt plus a rule telling the model to answer in the company's language. The **Reply in the
customer's language** switch (Settings > Assistant & claims behaviour, on by default) lets the assistant detect when a
customer writes in another language and answer in that language instead. Turn it off to always answer in the
company's language. Status-update messages use the template for the company's assistant language, or English
if there is none.

### Adding a language

1. **Registry:** add one entry to `LOCALE_REGISTRY` in `lib/i18n/locales.ts` with its `code` (ISO 639-1
   where possible), `name`, `nativeName`, `dir` (`ltr` or `rtl`), `intl` (the locale used for dates and
   numbers, e.g. `pt-BR`), `reviewed: false` and `regions`. The pickers, validation and database accept any
   registered code; no migration is needed (language columns are `VARCHAR(10)`).
2. **Dashboard strings:** copy `lib/i18n/locales/en.json` to `lib/i18n/locales/<code>.json` and translate
   the values. You can delete keys you have not translated yet; they fall back to English. Keep every
   `{placeholder}` exactly as it is, and don't translate the keys.
3. **Assistant strings:** copy `backend/internal/service/botlocales/en.json` to `botlocales/<code>.json` and
   translate **all** of its keys. `languageName` must equal the registry `name` and `nativeName` must equal
   the registry `nativeName`. The Go API embeds these files at build time.
4. **Check:** run `npm run check:locales` (add `--strict` to fail on missing dashboard keys),
   `cd backend && go test ./...` and `npx tsc --noEmit`. The checker verifies that every registered locale
   has both files, that there are no unknown or empty keys, that placeholders match English, and that the
   assistant file is complete.
5. **Right-to-left languages:** use logical Tailwind classes (`ms-*`, `me-*`, `ps-*`, `pe-*`, `start-*`,
   `end-*`, `text-start`, `border-s`) instead of `ml-*`, `mr-*`, `left-*` or `text-left` in new UI code, so
   the layout mirrors automatically.

To review a machine translation, edit the JSON files and set `reviewed: true` in the registry once a native
speaker has checked the whole dashboard file.

## Deployment

Run `npx prisma migrate deploy` before rollout and back up the database first. Keep `ENCRYPTION_KEY` stable: changing it makes stored secrets unreadable. Set `CORS_ALLOWED_ORIGINS` for the Go API to your dashboard origin(s); never expose secrets through `NEXT_PUBLIC_` variables. WhatsApp and LLM environment variables are optional single-tenant fallbacks only.

**Rate limits and client IP.** Sign-in is limited to 10 attempts per 15 minutes per client IP, plus a
per-account lockout (`LOGIN_MAX_FAILURES`, default 5 failures, then `LOGIN_LOCKOUT_MINUTES`, default 15).
Company signups are limited per IP (`SIGNUP_RATE_LIMIT_PER_HOUR`). By default the client IP is the TCP
peer address (stamped by `scripts/socket-ip.cjs`, which `npm start`, `npm run dev` and the Docker image
preload), and `X-Forwarded-For` is ignored, so a client cannot dodge the limit by sending a fake header.
Behind a reverse proxy or load balancer set `TRUSTED_PROXY=true` (one proxy) or `TRUSTED_PROXY=<hops>`;
the client IP is then taken from `X-Forwarded-For`, counting that many trusted hops from the right. Only
set it when the dashboard cannot be reached except through those proxies.

## Checks

Run `cd backend; go build ./...; go vet ./...; go test ./...`, `npm install; npx tsc --noEmit` and
`npm run check:locales` (all locales have valid keys and placeholders).

## License

RapidOS is free software, licensed under the **GNU Affero General Public License v3.0 only** (AGPL-3.0-only):
see [LICENSE](LICENSE) for the full text and [NOTICE](NOTICE).

Copyright (C) 2026 Raph Mwanza <raphmwanza5@gmail.com>

Under section 13 of the AGPL, if you run a modified version for users over a network you must offer them its
source code. The marketing site footer links to the license and the source code, and the sign-in page links to the
source code, at https://github.com/raphmwanza/RapidOS-open-source; if you publish a modified version, set
`githubUrl` in `config/site.ts` to your own repository. The RapidOS name and logo are not covered by the license: see
[TRADEMARK.md](TRADEMARK.md).
