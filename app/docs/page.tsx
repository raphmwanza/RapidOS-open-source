import Link from 'next/link';
import { DOCS_NAV } from '@/lib/marketing/docsNav';
import { pageMetadata } from '@/lib/marketing/metadata';
import { DocTitle, H2, P, UL, C } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'Documentation',
  description: 'Set up RapidOS: create your company, connect WhatsApp and an AI provider, use the dashboard, self-host with Docker and call the API.',
  path: '/docs',
});

export default function DocsHome() {
  return (
    <>
      <DocTitle
        title="RapidOS documentation"
        lead="Everything you need to run a WhatsApp claims assistant for your insurance company: from creating your account to self-hosting and the HTTP API."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {DOCS_NAV.filter((i) => i.href !== '/docs').map((item) => (
          <Link key={item.href} href={item.href} className="rounded-xl border border-gray-200 p-5 transition hover:border-emerald-300 hover:shadow-md">
            <h2 className="font-semibold text-gray-900">{item.title}</h2>
            <p className="mt-1 text-sm text-gray-600">{item.description}</p>
          </Link>
        ))}
      </div>

      <H2 id="how-it-works">How it works</H2>
      <P>RapidOS has four parts, all started by one <C>docker compose up</C>:</P>
      <UL>
        <li><strong>Go API</strong> (port 8080): receives WhatsApp messages from Meta on <C>/api/v1/whatsapp/webhook</C>, runs the conversation with your AI provider, collects the claim details and sends replies back through the WhatsApp Cloud API.</li>
        <li><strong>Dashboard</strong> (Next.js, port 3000): the web app your team uses for claims, conversations, clients, users and settings. It also serves this site and the <Link className="font-medium text-emerald-700 hover:underline" href="/docs/api">dashboard API</Link>.</li>
        <li><strong>PostgreSQL</strong>: companies, users, customers, conversations, claims and settings. Secrets such as WhatsApp tokens and AI keys are encrypted with AES-256-GCM.</li>
        <li><strong>Redis</strong>: rate limits for sign-in, signup and the API.</li>
      </UL>
      <P>
        One installation hosts several insurance companies (multi-tenant). Each company has its own WhatsApp number, AI provider, coverage types,
        assistant knowledge and team, and every request is scoped to the company of the signed-in user.
      </P>

      <H2 id="typical-flow">A claim, end to end</H2>
      <UL>
        <li>A customer writes to your WhatsApp Business number, in any of the 15 supported languages.</li>
        <li>The assistant asks the questions configured for the coverage type (for example policy number, date, place and what happened) and requests photos or documents.</li>
        <li>When the information is complete, a claim is created with a claim number and a PDF report, and the customer receives a confirmation.</li>
        <li>Your team reviews the claim in the dashboard, adds notes and documents and changes its status. Each status change sends the customer a WhatsApp update with the PDF.</li>
        <li>Agents can pause the assistant on any conversation and reply by hand.</li>
      </UL>
    </>
  );
}
