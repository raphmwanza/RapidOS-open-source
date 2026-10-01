import Link from 'next/link';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/marketing/metadata';
import { SITE } from '@/config/site';
import CodeBlock from '@/components/marketing/CodeBlock';
import { C, Callout, DocTitle, H2, H3, NextLink, OL, P, Table, UL } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'Self-hosting with Docker',
  description: 'Run RapidOS on your own server with Docker Compose: environment variables, commands, HTTPS, upgrades, backups and resets.',
  path: '/docs/self-hosting',
});

const a = 'font-medium text-emerald-700 hover:underline';

type EnvRow = [name: string, def: string, description: ReactNode];

const ENV_GROUPS: Array<{ id: string; title: string; rows: EnvRow[] }> = [
  {
    id: 'env-required',
    title: 'Required secrets',
    rows: [
      ['POSTGRES_PASSWORD', '(none)', 'Database password. Use hex (openssl rand -hex 32) so it is safe inside connection URLs.'],
      ['REDIS_PASSWORD', '(none)', 'Redis password.'],
      ['JWT_ACCESS_SECRET', '(none)', 'Signs access tokens.'],
      ['JWT_REFRESH_SECRET', '(none)', 'Signs refresh tokens. Must differ from the access secret.'],
      ['ENCRYPTION_KEY', '(none)', <>Base64 32-byte AES-256-GCM key for saved WhatsApp and AI secrets (<C>openssl rand -base64 32</C>). <strong>Never change it</strong> after setup: saved secrets would become unreadable.</>],
      ['INTERNAL_API_KEY', '(none)', 'Shared secret for calls between the dashboard and the Go API.'],
    ],
  },
  {
    id: 'env-database',
    title: 'Database and Redis',
    rows: [
      ['POSTGRES_DB', 'rapidos', 'Database name.'],
      ['POSTGRES_USER', 'rapidos_admin', 'Database user.'],
      ['DATABASE_URL, DIRECT_DATABASE_URL', 'localhost URL', 'Only used when you run the dashboard or the API outside Docker. Compose builds its own URLs (host postgres).'],
      ['REDIS_URL', 'localhost URL', 'Same: only for host-run processes.'],
    ],
  },
  {
    id: 'env-auth',
    title: 'Sessions and security',
    rows: [
      ['JWT_ACCESS_EXPIRES / JWT_EXPIRES_IN', '15m / 900', 'Access token lifetime (Go API / dashboard, in seconds for the dashboard).'],
      ['JWT_REFRESH_EXPIRES / JWT_REFRESH_EXPIRES_IN', '168h / 604800', 'Refresh token lifetime (7 days). Each account has one active session: signing in again signs the older browser out.'],
      ['BCRYPT_COST', '12', 'Password hashing cost.'],
      ['LOGIN_MAX_FAILURES', '5', 'Failed sign-ins before an account is locked.'],
      ['LOGIN_LOCKOUT_MINUTES', '15', 'Lock duration. An admin password reset unlocks the account.'],
      ['SIGNUP_RATE_LIMIT_PER_HOUR', '5', 'Company signups allowed per client IP per hour.'],
      ['CONTACT_RATE_LIMIT_PER_HOUR', '5', 'Requests allowed per client IP per hour on the public /contact form.'],
      ['TRUSTED_PROXY', '(empty)', <>Empty: rate limits use the TCP peer address and ignore <C>X-Forwarded-For</C>. Set <C>true</C> (one proxy) or a hop count only when the dashboard is reachable solely through your reverse proxies.</>],
      ['RATE_LIMIT_REQUESTS / RATE_LIMIT_WINDOW', '100 / 60', 'Go API rate limit: requests per window (seconds).'],
      ['CORS_ALLOWED_ORIGINS', 'http://localhost:3000', 'Browser origins allowed to call the Go API (comma-separated).'],
    ],
  },
  {
    id: 'env-urls',
    title: 'URLs and ports',
    rows: [
      ['NEXT_PUBLIC_BASE_URL', 'http://localhost:3000', 'Public URL of the dashboard (links in messages, canonical URLs of this site).'],
      ['PUBLIC_API_URL', '(empty)', 'Default public HTTPS base URL of the Go API as Meta sees it. Each company can override it in Settings.'],
      ['FRONTEND_BASE_URL', 'http://localhost:3000', 'Dashboard URL for host-run API processes (Compose uses http://dashboard:3000).'],
      ['BACKEND_URL', 'http://localhost:8080', 'Go API URL for a host-run dashboard (Compose uses http://api:8080).'],
      ['API_PORT', '8080', 'Port the Go API listens on.'],
      ['DASHBOARD_HOST_PORT / API_HOST_PORT', '3000 / 8080', 'Host ports published by Compose (bound to 127.0.0.1).'],
      ['POSTGRES_HOST_PORT / REDIS_HOST_PORT', '5432 / 6379', 'Host ports for Postgres and Redis (127.0.0.1 only).'],
      ['LOG_LEVEL', 'info', 'Log verbosity.'],
    ],
  },
  {
    id: 'env-fallbacks',
    title: 'Optional single-tenant fallbacks',
    rows: [
      ['WHATSAPP_ACCESS_TOKEN, WHATSAPP_VERIFY_TOKEN, WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_APP_SECRET, WHATSAPP_WEBHOOK_URL', '(empty)', 'Used only when a company saved no WhatsApp settings.'],
      ['WHATSAPP_GRAPH_API_BASE', 'https://graph.facebook.com/v18.0', 'Meta Graph API base, e.g. to point at a mock server in tests.'],
      ['LLM_PROVIDER, LLM_API_KEY, LLM_MODEL, LLM_BASE_URL', '(empty)', 'Used only when a company saved no AI settings. Provider: gemini, openai, deepseek, qwen or openai-compatible.'],
      ['LLM_TIMEOUT', '90', 'Seconds allowed for one AI request. Raise it for large local models on slow hardware.'],
    ],
  },
];

export default function SelfHostingDocs() {
  return (
    <>
      <DocTitle
        title="Self-hosting with Docker"
        lead="RapidOS is open source. One Docker Compose file starts PostgreSQL, Redis, the Go API and the dashboard on any Linux server, Mac or Windows machine."
      />

      <H2 id="requirements">Requirements</H2>
      <UL>
        <li>Docker Engine with Compose v2, or Docker Desktop.</li>
        <li>2 CPU cores, 4 GB RAM and 20 GB of disk for a small team (more for a local AI model).</li>
        <li>A domain name and HTTPS for production; Meta only sends webhooks to HTTPS URLs.</li>
      </UL>

      <H2 id="quick-start">Quick start</H2>
      <CodeBlock
        label="bash"
        code={`git clone ${SITE.githubUrl}.git rapidos
cd rapidos
cp .env.example .env          # PowerShell: Copy-Item .env.example .env

# generate the secrets and paste them into .env
openssl rand -hex 32          # POSTGRES_PASSWORD, REDIS_PASSWORD, JWT_ACCESS_SECRET,
                              # JWT_REFRESH_SECRET, INTERNAL_API_KEY (one value each)
openssl rand -base64 32       # ENCRYPTION_KEY

docker compose up -d --build
docker compose ps             # postgres, redis, api and dashboard become "healthy"`}
      />
      <P>
        The one-shot <C>migrate</C> service applies the database migrations before the API and the dashboard start. There is no demo data: open{' '}
        <C>http://localhost:3000/signup</C> to create your first company (see <Link className={a} href="/docs/getting-started">Getting started</Link>).
      </P>
      <Table
        head={['Service', 'URL', 'Health check']}
        rows={[
          ['Dashboard and this site', <C key="d">http://localhost:3000</C>, <C key="dh">GET /api/health</C>],
          ['Go API', <C key="a">http://localhost:8080</C>, <C key="ah">GET /health</C>],
          ['PostgreSQL / Redis', <C key="p">127.0.0.1:5432 / 127.0.0.1:6379</C>, 'Compose health checks'],
          ['Adminer (optional)', <C key="ad">http://localhost:8081</C>, <C key="adc">docker compose --profile tools up -d adminer</C>],
        ]}
      />

      <H2 id="environment">Environment variables</H2>
      <P>
        All settings live in <C>.env</C> next to <C>docker-compose.yml</C> (the file is gitignored; never commit it). WhatsApp and AI keys are normally entered per
        company in Settings, so they can stay empty here.
      </P>
      {ENV_GROUPS.map((g) => (
        <div key={g.id}>
          <H3 id={g.id}>{g.title}</H3>
          <Table head={['Variable', 'Default', 'Description']} rows={g.rows.map(([name, def, desc]) => [<C key="n">{name}</C>, <span key="d" className="whitespace-nowrap">{def}</span>, desc])} />
        </div>
      ))}

      <H2 id="commands">Everyday commands</H2>
      <CodeBlock
        label="bash"
        code={`docker compose ps                       # status of every service
docker compose logs -f api dashboard    # follow the logs
docker compose restart api              # restart one service
docker compose down                     # stop everything (data is kept)
docker compose up -d                    # start again`}
      />

      <H2 id="production">Production checklist</H2>
      <UL>
        <li>Put a reverse proxy with HTTPS (Caddy, Nginx, Traefik) in front of the dashboard (port 3000) and the Go API (port 8080). Compose binds both to 127.0.0.1, so they are not exposed directly.</li>
        <li>Set <C>NEXT_PUBLIC_BASE_URL</C> to your dashboard URL, <C>PUBLIC_API_URL</C> to the public API URL and <C>CORS_ALLOWED_ORIGINS</C> to the dashboard origin.</li>
        <li>Set <C>TRUSTED_PROXY=true</C> when the proxy is the only way in, so rate limits see the real client IP.</li>
        <li>Back up the database <strong>and</strong> the files volume every day, and keep a copy of <C>.env</C> (especially <C>ENCRYPTION_KEY</C>) somewhere safe.</li>
        <li>
          Deploying on Railway instead of your own server? The service settings and every variable, with Railway&apos;s <C>{'${{Postgres.DATABASE_URL}}'}</C>{' '}
          references, are in{' '}
          <a className={a} href={`${SITE.githubUrl}/blob/main/docs/railway.md`} target="_blank" rel="noopener noreferrer">
            docs/railway.md
          </a>
          .
        </li>
      </UL>
      <CodeBlock
        label="Caddyfile"
        code={`claims.example.com {
  reverse_proxy 127.0.0.1:3000
}
claims-api.example.com {
  reverse_proxy 127.0.0.1:8080
}`}
      />

      <H2 id="upgrades">Upgrades</H2>
      <CodeBlock
        label="bash"
        code={`# back up first (see below), then:
git pull
docker compose up -d --build   # migrations run automatically before the new version starts`}
      />

      <H2 id="backups">Backups</H2>
      <P>
        A complete backup has two parts: the PostgreSQL database and the <C>dashboard_files</C> volume (claim documents, WhatsApp media, claim PDFs and knowledge
        documents, stored under <C>/app/storage</C>). The volume name is prefixed with the Compose project name, <C>rapidos-oss</C> by default.
      </P>
      <CodeBlock
        label="Back up"
        code={`STAMP=$(date +%Y%m%d-%H%M%S)
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup-$STAMP.sql
docker run --rm -v rapidos-oss_dashboard_files:/data -v "$PWD":/backup alpine \\
  tar czf /backup/files-$STAMP.tgz -C /data .`}
      />
      <CodeBlock
        label="Restore into a fresh installation"
        code={`docker compose down -v                   # WARNING: deletes the current database and files
docker compose up -d postgres redis
docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"' < backup-20261001-020000.sql
docker run --rm -v rapidos-oss_dashboard_files:/data -v "$PWD":/backup alpine \\
  tar xzf /backup/files-20261001-020000.tgz -C /data
docker compose up -d`}
      />
      <Callout kind="warn" title="Keep the same ENCRYPTION_KEY">
        Restore with the same <C>.env</C>. With a different <C>ENCRYPTION_KEY</C>, the saved WhatsApp tokens and AI keys cannot be decrypted and must be entered
        again in Settings.
      </Callout>

      <H2 id="reset">Reset</H2>
      <OL>
        <li><strong>Full reset</strong> (delete every company, user, claim and file): <C>docker compose down -v</C>, then <C>docker compose up -d</C>. You start again from <C>/signup</C>.</li>
        <li><strong>Back to a known state</strong>: take a backup right after your initial setup (companies, users, settings) and restore it whenever you want to remove test conversations and claims.</li>
      </OL>

      <H2 id="development">Development without Docker</H2>
      <CodeBlock
        label="bash"
        code={`# Postgres and Redis from Compose, the apps on the host
docker compose up -d postgres redis
npm install && npx prisma migrate deploy && npm run dev     # dashboard on :3000
cd backend && go run ./cmd/api                               # Go API on :8080

# checks
npx tsc --noEmit && npm run lint && npm run test:unit && npm run check:locales
cd backend && go build ./... && go vet ./... && go test ./...`}
      />

      <NextLink href="/docs/api" title="API reference" />
    </>
  );
}
