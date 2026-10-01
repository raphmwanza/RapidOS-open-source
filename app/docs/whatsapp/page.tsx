import Link from 'next/link';
import { pageMetadata } from '@/lib/marketing/metadata';
import Screenshot from '@/components/marketing/Screenshot';
import CodeBlock from '@/components/marketing/CodeBlock';
import { C, Callout, DocTitle, H2, H3, NextLink, OL, P, Table, UL } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'WhatsApp / Meta setup',
  description: 'Connect a WhatsApp Business number to RapidOS: phone number ID, WABA ID, access token, app secret, verify token and the webhook callback URL.',
  path: '/docs/whatsapp',
});

const a = 'font-medium text-emerald-700 hover:underline';

export default function WhatsAppDocs() {
  return (
    <>
      <DocTitle
        title="WhatsApp / Meta setup"
        lead="RapidOS uses the official WhatsApp Business Cloud API from Meta. Each company connects its own number in Settings; no code or environment variable is needed."
      />

      <H2 id="before-you-start">Before you start</H2>
      <UL>
        <li>A <strong>Meta developer account</strong> and a <strong>Meta Business</strong> portfolio.</li>
        <li>A Meta app of type <strong>Business</strong> with the <strong>WhatsApp</strong> product added. Meta gives you a free test number to start with.</li>
        <li>An HTTPS address where Meta can reach the RapidOS Go API (port 8080). On a laptop, use a tunnel such as ngrok (see below).</li>
        <li>An account with the <strong>Super admin</strong> or <strong>Admin</strong> role in RapidOS.</li>
      </UL>

      <H2 id="values">Values to collect in Meta</H2>
      <Table
        head={['RapidOS field', 'Where to find it in Meta', 'Notes']}
        rows={[
          [<strong key="1">Phone number ID</strong>, 'App Dashboard → WhatsApp → API Setup', 'Digits only. Identifies the number messages are sent from. One phone number ID can only belong to one company.'],
          [<strong key="2">WhatsApp Business account ID</strong>, 'App Dashboard → WhatsApp → API Setup', 'The WABA ID, shown next to the phone number ID.'],
          [<strong key="3">Access token</strong>, 'Business Settings → Users → System users → Generate token', 'Use a permanent System User token with the whatsapp_business_messaging permission. The temporary token on API Setup expires after 24 hours.'],
          [<strong key="4">App secret</strong>, 'App Dashboard → App settings → Basic', 'Used to check the X-Hub-Signature-256 header, so RapidOS only accepts webhook calls that really come from Meta.'],
          [<strong key="5">Verify token</strong>, 'You choose it', '8–128 characters, no spaces. Type one or click Generate new. You paste the same value into Meta.'],
          [<strong key="6">Display number</strong>, 'Your WhatsApp number', 'Optional. The number customers see, e.g. +1 416 555 0199.'],
        ]}
      />

      <H2 id="settings">Enter them in RapidOS</H2>
      <OL>
        <li>Sign in and open <strong>Settings</strong>. Scroll to the <strong>WhatsApp integration</strong> card.</li>
        <li>Fill in the phone number ID, business account ID, access token and app secret.</li>
        <li>Type a verify token or click <strong>Generate new</strong>.</li>
        <li>Set the <strong>Public API base URL</strong>: the HTTPS address of your Go API as Meta sees it, for example <C>https://claims-api.example.com</C> or your ngrok address. Leave it blank to use the server default (<C>PUBLIC_API_URL</C>).</li>
        <li>Click <strong>Save</strong>.</li>
      </OL>
      <P>
        Secrets are stored encrypted (AES-256-GCM) and only shown masked afterwards (the last four characters, for example <C>••••f3kQ</C>). Leaving a secret field blank keeps the saved
        value. The verify token can be revealed and copied, because you need to paste it into Meta.
      </P>
      <Screenshot id="settingsWhatsapp" caption="The WhatsApp card after saving. All values in this screenshot are fake." />

      <H2 id="webhook">Connect the webhook</H2>
      <P>The callback URL is your public base URL followed by a fixed path:</P>
      <CodeBlock label="Callback URL" code="https://<host>/api/v1/whatsapp/webhook" />
      <OL>
        <li>In the Meta App Dashboard, open <strong>WhatsApp → Configuration</strong> and click <strong>Edit</strong> under Webhook.</li>
        <li>Paste the <strong>Callback URL</strong> and the <strong>Verify token</strong> shown in the RapidOS card (use the copy buttons), then click <strong>Verify and save</strong>.</li>
        <li>Under <strong>Webhook fields</strong>, subscribe to <C>messages</C>.</li>
        <li>Back in RapidOS, click <strong>Test webhook</strong>. It runs Meta&apos;s verification handshake against the API with the saved token, and against the public URL when one is set.</li>
        <li>Send a WhatsApp message to your number. The conversation appears in <strong>Conversations</strong> within a few seconds.</li>
      </OL>
      <Callout kind="info" title="How verification works">
        Meta calls <C>GET /api/v1/whatsapp/webhook?hub.mode=subscribe&amp;hub.verify_token=…&amp;hub.challenge=…</C>. The API compares the token with every
        company&apos;s saved verify token and answers with the challenge on a match, so a new token works immediately. Incoming messages are routed to the company
        whose phone number ID matches the message metadata. See the <Link className={a} href="/docs/api#webhook">webhook API reference</Link>.
      </Callout>

      <H2 id="ngrok">Local testing with ngrok</H2>
      <P>Meta only accepts a public HTTPS URL. When RapidOS runs on your computer, open a tunnel to the Go API:</P>
      <CodeBlock label="bash" code={'ngrok http 8080\n# Forwarding  https://ab12-34-56.ngrok-free.app -> http://localhost:8080'} />
      <P>
        Paste the <C>https://…ngrok-free.app</C> address into <strong>Public API base URL</strong>, save, and use the resulting callback URL in Meta. The free ngrok
        address changes every time you restart ngrok: update the base URL in Settings and in Meta when it does. Self-hosters can set <C>PUBLIC_API_URL</C> in
        <C>.env</C> as the default for every company.
      </P>
      <P>
        With Meta&apos;s test number, add your own WhatsApp number as a test recipient in <strong>API Setup</strong>; only listed recipients can exchange messages
        with a test number.
      </P>

      <H2 id="troubleshooting">Troubleshooting</H2>
      <Table
        head={['Symptom', 'What to check']}
        rows={[
          ['Meta says "The callback URL or verify token couldn\'t be validated"', 'The tunnel is running and points to port 8080, the URL ends with /api/v1/whatsapp/webhook, and the verify token was saved in RapidOS before you clicked Verify.'],
          ['Test webhook: "The API rejected the saved verify token"', 'Save the form first; the test uses the saved token, not the one typed in the field.'],
          ['Messages arrive in Meta but not in RapidOS', 'You subscribed to the messages field, and the phone number ID in Settings matches the number that receives the messages.'],
          ['Webhook calls are rejected with 401', 'The app secret in Settings is the secret of the same Meta app that sends the webhook.'],
          ['The assistant does not answer', 'The access token is valid and has whatsapp_business_messaging, and your AI provider passes Test bot.'],
        ]}
      />

      <H3>Fallback environment variables</H3>
      <P>
        Single-company installations can use <C>WHATSAPP_ACCESS_TOKEN</C>, <C>WHATSAPP_VERIFY_TOKEN</C>, <C>WHATSAPP_PHONE_NUMBER_ID</C> and <C>WHATSAPP_APP_SECRET</C>
        instead of Settings. Values saved in Settings always take priority. See <Link className={a} href="/docs/self-hosting#environment">Self-hosting</Link>.
      </P>

      <NextLink href="/docs/ai-providers" title="AI providers" />
    </>
  );
}
