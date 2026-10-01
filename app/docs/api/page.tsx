import Link from 'next/link';
import { pageMetadata } from '@/lib/marketing/metadata';
import CodeBlock from '@/components/marketing/CodeBlock';
import { C, Callout, DocTitle, H2, H3, P, Table } from '@/components/marketing/Prose';
import {
  API_GROUPS,
  AUTH_SCHEMES,
  SIGNATURE_BASH,
  SIGNATURE_GO,
  SIGNATURE_NODE,
  WEBHOOK_IMAGE_MESSAGE,
  WEBHOOK_PAYLOAD,
  curlFor,
  endpointAnchor,
  endpointCount,
  type ApiEndpoint,
  type HttpMethod,
} from '@/lib/marketing/api';

export const metadata = pageMetadata({
  title: 'API reference',
  description: 'HTTP API of RapidOS: authentication, users, claims, PDFs, documents, clients, conversations, settings, analytics, the WhatsApp webhook and the internal service API, with curl examples.',
  path: '/docs/api',
});

const a = 'font-medium text-emerald-700 hover:underline';

const METHOD_STYLES: Record<HttpMethod, string> = {
  GET: 'bg-sky-100 text-sky-800',
  POST: 'bg-emerald-100 text-emerald-800',
  PUT: 'bg-amber-100 text-amber-800',
  PATCH: 'bg-violet-100 text-violet-800',
  DELETE: 'bg-rose-100 text-rose-800',
};

function MethodBadge({ method }: { method: HttpMethod }) {
  return <span className={`inline-flex w-16 shrink-0 justify-center rounded px-2 py-0.5 font-mono text-xs font-bold ${METHOD_STYLES[method]}`}>{method}</span>;
}

function Endpoint({ e }: { e: ApiEndpoint }) {
  const id = endpointAnchor(e);
  const auth = AUTH_SCHEMES[e.auth];
  return (
    <section id={id} className="mt-8 scroll-mt-24 rounded-xl border border-gray-200 bg-white p-4 sm:p-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <MethodBadge method={e.method} />
        <a href={`#${id}`} className="min-w-0 break-all font-mono text-sm font-semibold text-gray-900 hover:text-emerald-700">{e.path}</a>
      </div>
      <h4 className="mt-3 text-base font-semibold text-gray-900">{e.summary}</h4>
      <div className="mt-2 flex flex-wrap gap-2 text-xs">
        <span className="rounded-full bg-gray-100 px-2.5 py-1 font-medium text-gray-700">{e.service === 'api' ? 'Go API :8080' : 'Dashboard :3000'}</span>
        <span className="rounded-full bg-gray-900 px-2.5 py-1 font-medium text-white" title={auth.description}>{auth.label}</span>
        {e.roles && <span className="rounded-full bg-emerald-50 px-2.5 py-1 font-medium text-emerald-800">Roles: {e.roles}</span>}
      </div>
      {e.description && <p className="mt-3 text-sm leading-6 text-gray-700">{e.description}</p>}

      {e.params && e.params.length > 0 && (
        <>
          <h5 className="mt-5 text-sm font-semibold text-gray-900">Parameters</h5>
          <Table
            head={['Name', 'In', 'Type', 'Description']}
            rows={e.params.map((p) => [
              <span key="n" className="font-mono text-xs [overflow-wrap:anywhere]">{p.name}{p.required && <span className="ml-1 text-rose-600" title="required">*</span>}</span>,
              <span key="i" className="text-xs">{p.in}</span>,
              <span key="t" className="font-mono text-xs [overflow-wrap:anywhere]">{p.type}</span>,
              <span key="d" className="text-xs">{p.description}</span>,
            ])}
          />
        </>
      )}

      {e.body && !e.form && <CodeBlock label="Request body (JSON)" code={e.body} />}
      {e.response && <CodeBlock label={`Response ${e.successStatus ?? 200}`} code={e.response} />}

      {e.errors && e.errors.length > 0 && (
        <>
          <h5 className="mt-5 text-sm font-semibold text-gray-900">Errors</h5>
          <Table
            head={['Status', 'error', 'When']}
            rows={e.errors.map((err) => [
              <span key="s" className="font-mono text-xs">{err.status}</span>,
              <span key="e" className="font-mono text-xs [overflow-wrap:anywhere]">{err.error}</span>,
              <span key="w" className="text-xs">{err.when}</span>,
            ])}
          />
        </>
      )}

      <CodeBlock label="curl" code={curlFor(e)} />
    </section>
  );
}

export default function ApiReference() {
  const counts = endpointCount();
  return (
    <>
      <DocTitle
        title="API reference"
        lead={`Everything the dashboard does goes through these HTTP endpoints: ${counts.dashboard} on the dashboard (port 3000) and ${counts.api} on the Go API (port 8080).`}
      />

      <H2 id="basics">Basics</H2>
      <Table
        head={['Service', 'Base URL (local)', 'Used for']}
        rows={[
          ['Dashboard', <span key="b" className="whitespace-nowrap"><C>http://localhost:3000</C></span>, 'Everything your team and your integrations need: accounts, claims, clients, conversations, settings.'],
          ['Go API', <span key="a" className="whitespace-nowrap"><C>http://localhost:8080</C></span>, 'The WhatsApp webhook (public) and internal service routes (keep private).'],
        ]}
      />
      <P>
        Requests and responses are JSON (UTF-8) unless stated otherwise. Errors return an HTTP status and a body such as <C>{'{ "error": "Insufficient role permissions" }'}</C>,
        sometimes with a machine-readable <C>code</C> or a <C>fields</C> map for validation errors. Every request is scoped to the company of the signed-in user:
        records of other companies are never returned or changed.
      </P>
      <P>The curl examples use these shell variables:</P>
      <CodeBlock
        label="bash"
        code={`export BASE=http://localhost:3000          # dashboard
export API=http://localhost:8080           # Go API
export TOKEN=<accessToken from POST /api/auth/login>
export INTERNAL_API_KEY=<value from .env>  # internal routes only
export COMPANY_ID=<company uuid>           # internal routes only`}
      />

      <H3 id="authentication">Authentication</H3>
      <P>
        Sign in with <Link className={a} href="#post-api-auth-login">POST /api/auth/login</Link> and send the returned <C>accessToken</C> as{' '}
        <C>Authorization: Bearer $TOKEN</C>. Access tokens expire after 15 minutes by default: call{' '}
        <Link className={a} href="#post-api-auth-refresh">POST /api/auth/refresh</Link> with the <C>refreshToken</C> cookie to get a new one. For scripts, create a
        dedicated user with the smallest role that works (for example <strong>Viewer</strong> for reporting).
      </P>
      <Table head={['Scheme', 'How to authenticate']} rows={Object.values(AUTH_SCHEMES).map((s) => [<strong key="l">{s.label}</strong>, s.description])} />
      <Callout kind="info" title="Roles">
        When an endpoint lists roles, other roles get <C>403</C>. Without a list, any active user of the company may call it, but <strong>Viewer</strong> accounts
        can only use read methods (GET).
      </Callout>

      <H3 id="contents">Contents</H3>
      <ul className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
        {API_GROUPS.map((g) => (
          <li key={g.id}>
            <a href={`#${g.id}`} className={a}>{g.title}</a> <span className="text-gray-500">({g.endpoints.length})</span>
          </li>
        ))}
        <li><a href="#webhook-signature" className={a}>Webhook signatures</a></li>
      </ul>

      {API_GROUPS.map((g) => (
        <div key={g.id}>
          <H2 id={g.id}>{g.title}</H2>
          <P>{g.description}</P>
          <ul className="mt-4 space-y-1.5">
            {g.endpoints.map((e) => (
              <li key={endpointAnchor(e)} className="flex items-center gap-3 text-sm">
                <MethodBadge method={e.method} />
                <a href={`#${endpointAnchor(e)}`} className="min-w-0 break-all font-mono text-gray-800 hover:text-emerald-700">{e.path}</a>
              </li>
            ))}
          </ul>
          {g.endpoints.map((e) => (
            <Endpoint key={endpointAnchor(e)} e={e} />
          ))}
        </div>
      ))}

      <H2 id="webhook-signature">Webhook signatures</H2>
      <P>
        Meta signs every webhook call with your app secret. RapidOS recomputes the signature over the raw request body and rejects the call with <C>401</C> when it
        does not match or when no app secret is saved. To send test events yourself (for example from a staging script), sign the exact bytes you send:
      </P>
      <CodeBlock label="Node.js" code={SIGNATURE_NODE} />
      <CodeBlock label="bash + openssl" code={SIGNATURE_BASH} />
      <P>The check on the server:</P>
      <CodeBlock label="Go" code={SIGNATURE_GO} />
      <H3 id="webhook-payloads">Example payloads</H3>
      <P>A text message from a customer, as Meta sends it:</P>
      <CodeBlock label="POST /api/v1/whatsapp/webhook (JSON)" code={WEBHOOK_PAYLOAD} />
      <P>An image message (the media is downloaded from the Graph API with the company access token and attached to the claim):</P>
      <CodeBlock label="messages[] item (JSON)" code={WEBHOOK_IMAGE_MESSAGE} />
    </>
  );
}
