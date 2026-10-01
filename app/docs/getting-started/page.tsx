import Link from 'next/link';
import { pageMetadata } from '@/lib/marketing/metadata';
import Screenshot from '@/components/marketing/Screenshot';
import { C, Callout, DocTitle, H2, H3, NextLink, OL, P, UL } from '@/components/marketing/Prose';

export const metadata = pageMetadata({
  title: 'Getting started',
  description: 'Create your RapidOS company account with the 6-step signup wizard, save the generated password and sign in for the first time.',
  path: '/docs/getting-started',
});

const a = 'font-medium text-emerald-700 hover:underline';

export default function GettingStarted() {
  return (
    <>
      <DocTitle
        title="Getting started"
        lead="Create your company account in a few minutes. You don't need a WhatsApp number or an AI key yet: you can connect them later in Settings."
      />

      <P>
        Open <Link className={a} href="/signup">/signup</Link> (or click <strong>Create account</strong> at the top of this page). The wizard has six steps.
        You can go back to any completed step from the list on the left, and nothing is saved until you click <strong>Create account</strong> on the last step.
      </P>

      <H2 id="step-1-company">Step 1: Company</H2>
      <P>
        Enter your <strong>company name</strong>, <strong>country</strong> and <strong>city</strong>. The <strong>Company ID</strong> (a short identifier made of lowercase
        letters, numbers and hyphens) is filled in from the name; you can change it. Website and street address are optional.
      </P>
      <Screenshot id="signupCompany" />

      <H2 id="step-2-contact">Step 2: Contact &amp; brand</H2>
      <P>
        The <strong>customer support email</strong> and <strong>phone</strong> are required. The assistant gives these details to customers who ask how to reach you.
        Optionally add a claims email, business hours, the WhatsApp number customers will message, a logo URL and your brand colour (used in claim PDFs).
      </P>
      <Screenshot id="signupContact" />

      <H2 id="step-3-administrator">Step 3: Administrator</H2>
      <P>
        Enter the first name, last name and work email of the person who will manage the account. This person becomes the <strong>super admin</strong> with full
        access. You don&apos;t choose a password: a secure one is generated for you at the end.
      </P>
      <Screenshot id="signupAdmin" />

      <H2 id="step-4-coverage">Step 4: Coverage</H2>
      <P>
        Choose the types of claims you handle: auto, health, home / property, fire, life, travel and business. Select at least one. Each type comes with default
        questions and required documents for the assistant; you can edit them later in <strong>Settings &gt; Coverage types</strong>.
      </P>
      <Screenshot id="signupCoverage" />

      <H2 id="step-5-assistant">Step 5: Assistant</H2>
      <P>
        Pick the language of your WhatsApp assistant (also the default dashboard language for your team) and switch the assistant behaviours on or off:
      </P>
      <UL>
        <li>Ask for photos when a claim is filed</li>
        <li>Ask for supporting documents</li>
        <li>Hand off to a human agent when a customer is upset or asks for a person</li>
        <li>Let customers check the status of their claim</li>
        <li>Notify customers when a claim status changes</li>
        <li>Reply in the customer&apos;s language</li>
      </UL>
      <P>The assistant comes with ready-made instructions written for your company, so you don&apos;t need to write any prompts.</P>
      <Screenshot id="signupAssistant" />

      <H2 id="step-6-review">Step 6: Review</H2>
      <P>Check every value. Click <strong>Edit</strong> next to a section to go back to it, then click <strong>Create account</strong>.</P>
      <Screenshot id="signupReview" />

      <H2 id="generated-password">Save the generated password</H2>
      <P>
        The success screen shows the admin email and a <strong>generated password</strong>. It is shown <strong>only once</strong>: copy it with
        <strong> Copy password</strong> and store it in a password manager, then tick <strong>I have saved the password</strong> and click <strong>Go to login</strong>.
      </P>
      <Screenshot id="signupDone" caption="The password is hidden in this screenshot. On your screen it is shown in full." />
      <Callout kind="warn" title="Lost the password?">
        There is no self-service password change or e-mail reset. Another super admin or admin of your company can reset it from <strong>Users</strong>; a new
        password is generated and shown once. Signups are limited per network (5 per hour by default) to prevent abuse.
      </Callout>

      <H2 id="first-login">First sign-in</H2>
      <OL>
        <li>Go to <Link className={a} href="/login">/login</Link> and sign in with the admin email and the generated password.</li>
        <li>You land on the dashboard home. It stays empty until customers write to your WhatsApp number.</li>
        <li>
          Open <strong>Settings</strong> and connect <Link className={a} href="/docs/whatsapp">WhatsApp</Link> and your{' '}
          <Link className={a} href="/docs/ai-providers">AI provider</Link>. Use <strong>Test bot</strong> to check the AI provider before going live.
        </li>
        <li>Invite your team from <strong>Users</strong> (see <Link className={a} href="/docs/dashboard#users">roles</Link>).</li>
      </OL>
      <Screenshot id="login" />

      <H3>Sessions</H3>
      <P>
        You stay signed in for up to 7 days (refresh token), with short-lived access tokens renewed automatically. After 5 failed sign-ins the account is locked
        for 15 minutes; an admin password reset unlocks it. Self-hosters can change these limits with <C>LOGIN_MAX_FAILURES</C> and <C>LOGIN_LOCKOUT_MINUTES</C>.
      </P>

      <NextLink href="/docs/whatsapp" title="WhatsApp / Meta setup" />
    </>
  );
}
