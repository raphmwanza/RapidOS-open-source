import Link from 'next/link';
import { pageMetadata } from '@/lib/marketing/metadata';
import Screenshot from '@/components/marketing/Screenshot';
import { C, Callout, DocTitle, H2, H3, NextLink, P, Table, UL } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'Using the dashboard',
  description: 'Work with claims, WhatsApp conversations, clients, users, roles and settings in the RapidOS dashboard.',
  path: '/docs/dashboard',
});

const a = 'font-medium text-emerald-700 hover:underline';

export default function DashboardDocs() {
  return (
    <>
      <DocTitle
        title="Using the dashboard"
        lead="The dashboard is where your team follows every claim and conversation. It is available in 15 languages; each user can pick their own from the menu."
      />

      <H2 id="home">Dashboard home</H2>
      <P>
        The home page shows the total number of claims, the resolution rate, the number of conversations and customer satisfaction, followed by the most recent
        claims. Agents can also create a claim by hand (for example after a phone call) with <strong>Create a new claim</strong>.
      </P>
      <Screenshot id="home" />

      <H2 id="claims">Claims</H2>
      <P>
        <strong>Claims</strong> lists every claim with its number, coverage type, customer, date and status (<strong>New</strong>, <strong>Ongoing</strong>,{' '}
        <strong>Approved</strong>, <strong>Rejected</strong> or <strong>Completed</strong>). Search by claim number, customer name, phone or description.
      </P>
      <Screenshot id="claims" />
      <H3 id="claim-detail">Claim page</H3>
      <UL>
        <li>All the information the assistant collected, grouped by the questions of the coverage type.</li>
        <li>Photos and documents sent on WhatsApp or uploaded by your team. Add more with the upload area.</li>
        <li><strong>Status</strong>: changing it records the change in the history and, when <em>Notify customers when a claim status changes</em> is on, sends the customer a WhatsApp message with the updated PDF.</li>
        <li><strong>Notes and comments</strong> for your team (never sent to the customer).</li>
        <li><strong>Download PDF</strong>: a claim report with your logo, colours and contact details, in the customer&apos;s language.</li>
        <li><strong>Send a direct message</strong> to the customer on WhatsApp.</li>
      </UL>
      <Screenshot id="claimDetail" />

      <H2 id="conversations">Conversations</H2>
      <P>
        <strong>Conversations</strong> shows WhatsApp conversations in real time, with emergency conversations (for example a customer asking for a person or
        reporting an injury) at the top. Open one to read the full exchange, the customer&apos;s details and their claims.
      </P>
      <P>
        Click <strong>Pause bot</strong> to take over: the assistant stops answering that customer and you can reply from the message box. Click{' '}
        <strong>Resume bot</strong> to hand the conversation back.
      </P>
      <Screenshot id="conversation" />

      <H2 id="clients">Clients</H2>
      <P>
        Every WhatsApp customer becomes a client, identified by phone number. The client page lists their contact details and all their claims, so a returning
        customer&apos;s history is one click away. Search by name, phone, email, claim number, type or status. Agents can also add a client by hand with{' '}
        <strong>New client</strong>.
      </P>
      <Screenshot id="client" />

      <H2 id="analysis">Advanced analysis</H2>
      <P>Key figures for your team: total and resolved claims, resolution rate, average assistant response time, escalation rate, customer satisfaction and a breakdown of activity by status.</P>

      <H2 id="users">Users and roles</H2>
      <P>Admins add teammates in <strong>Users</strong>. Each new user gets a generated password, shown once, to pass on securely.</P>
      <Table
        head={['Role', 'Can do']}
        rows={[
          [<strong key="s">Super admin</strong>, 'Everything, including managing other super admins. The last active super admin can never be demoted or deactivated.'],
          [<strong key="a">Admin</strong>, 'Settings, WhatsApp and AI integrations, and users (except super admins).'],
          [<strong key="m">Moderator</strong>, 'Agent work, plus archiving conversations and deleting customers.'],
          [<strong key="g">Agent</strong>, 'Conversations, customers, claims, notes and documents.'],
          [<strong key="v">Viewer</strong>, 'Read-only. Create, edit and delete controls are hidden and the API rejects write requests.'],
        ]}
      />
      <P>
        Admins can change roles, deactivate and reactivate accounts and reset passwords. A reset or a deactivation signs the user out everywhere on their next
        request.
      </P>
      <Screenshot id="users" />

      <H2 id="settings">Settings</H2>
      <Table
        head={['Section', 'What you configure']}
        rows={[
          ['Language', 'The assistant language and the default dashboard language of the company.'],
          ['Assistant & claims behaviour', 'Photos, documents, human hand-off, claim status lookup, status notifications and replying in the customer\'s language.'],
          ['Coverage types', 'The claim types you handle, and for each one the questions the assistant asks and the documents it requests.'],
          [<Link key="w" className={a} href="/docs/whatsapp">WhatsApp integration</Link>, 'Phone number ID, WABA ID, access token, app secret, verify token and the webhook.'],
          [<Link key="ai" className={a} href="/docs/ai-providers">AI provider</Link>, 'Provider, model, base URL, API key and Test bot.'],
          ['Company profile', 'Name, logo and primary colour used in claim PDFs.'],
          ['Assistant knowledge', 'Texts and documents (PDF, TXT, Markdown, CSV, JSON or XML, up to 10 MB) the assistant uses to answer questions about your products, opening hours or procedures.'],
        ]}
      />
      <H3 id="knowledge">Assistant knowledge</H3>
      <P>
        In <strong>Settings → Assistant knowledge</strong>, add <strong>texts</strong> (a title and a few paragraphs) or upload <strong>documents</strong> (PDF, TXT,
        Markdown, CSV, JSON or XML, up to 10 MB). The assistant uses the active items to answer customers&apos; questions about your products, opening hours or
        procedures; the text of uploaded documents is extracted when you save them.
      </P>
      <Callout kind="tip">
        Keep knowledge items short and specific (one topic per item). Switch an item off to hide it from the assistant without deleting it.
      </Callout>
      <P>
        Prefer to automate? Everything in the dashboard is available through the <Link className={a} href="/docs/api">HTTP API</Link>, authenticated with the same
        accounts (<C>Authorization: Bearer</C>).
      </P>

      <NextLink href="/docs/self-hosting" title="Self-hosting with Docker" />
    </>
  );
}
