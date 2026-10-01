import Link from 'next/link';
import MarketingShell from '@/components/marketing/MarketingShell';
import Screenshot from '@/components/marketing/Screenshot';
import { pageMetadata } from '@/lib/marketing/metadata';
import { SITE } from '@/config/site';

export const metadata = pageMetadata({
  description: SITE.description,
  path: '/',
});

const PROBLEMS = [
  {
    title: 'Customers live on WhatsApp',
    text: 'In Kinshasa, Lagos, Nairobi or Manila, people message before they call, and rarely install an insurer app or open a web portal.',
  },
  {
    title: 'Claims arrive in pieces',
    text: 'A photo here, a voice call there, a policy number on paper. Teams spend days chasing missing details before they can even assess a claim.',
  },
  {
    title: 'Small teams, many languages',
    text: 'Claims staff juggle French, English, Swahili, Lingala or Hausa, outside office hours, with no structured record of what was said.',
  },
];

const FEATURES = [
  { icon: '💬', title: 'WhatsApp assistant, 24/7', text: 'Customers report an incident in their own words. The assistant asks only for what is missing: policy number, date, place, what happened.' },
  { icon: '📷', title: 'Photos and documents', text: 'Damage photos, licences and invoices sent on WhatsApp are stored with the claim, ready for your assessors.' },
  { icon: '📄', title: 'Structured claims and PDFs', text: 'Every claim gets a number, a clean data sheet per coverage type and a branded PDF report.' },
  { icon: '🔔', title: 'Status updates', text: 'Change a claim status in the dashboard and the customer is told on WhatsApp, with the updated PDF.' },
  { icon: '🙋', title: 'Human hand-off', text: 'Upset customers and requests for a person are flagged. Agents pause the bot and reply themselves.' },
  { icon: '🌍', title: '15 languages', text: 'English, French, Portuguese, Spanish, Arabic, Swahili, Lingala, Hausa, Yoruba, Amharic, Hindi, Bengali, Vietnamese, Indonesian and Filipino.' },
  { icon: '🧠', title: 'Your choice of AI', text: 'Google Gemini, OpenAI, DeepSeek, Qwen, or a model running on your own server with Ollama.' },
  { icon: '🏢', title: 'Multi-company, with roles', text: 'Several insurers or brands on one installation, each with its own number, settings and team: super admin, admin, moderator, agent and viewer.' },
];

const STEPS = [
  { title: 'Create your account', text: 'A 6-step wizard sets up your company, coverage types and assistant. No prompt writing needed.', href: '/docs/getting-started' },
  { title: 'Connect WhatsApp', text: 'Paste your WhatsApp Business Cloud API details and register the webhook in Meta.', href: '/docs/whatsapp' },
  { title: 'Pick an AI model', text: 'Add an API key for Gemini, OpenAI, DeepSeek or Qwen, or point to your own model. Check it with Test bot.', href: '/docs/ai-providers' },
  { title: 'Receive claims', text: 'Customers write to your number; complete claims appear in the dashboard for your team.', href: '/docs/dashboard' },
];

export default function LandingPage() {
  return (
    <MarketingShell>
      {/* Hero */}
      <section className="relative overflow-hidden bg-gradient-to-b from-emerald-50 via-white to-white">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-16 pt-14 sm:px-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:pt-20">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full border border-emerald-200 bg-white px-3 py-1 text-xs font-semibold text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" /> Open source · Self-host with Docker
            </p>
            <h1 className="mt-6 text-4xl font-bold leading-tight tracking-tight text-gray-900 sm:text-5xl">
              Insurance claims, filed on WhatsApp.
            </h1>
            <p className="mt-6 text-lg leading-8 text-gray-600">
              {SITE.name} gives insurers in emerging markets an AI assistant that collects claims on WhatsApp, in the customer&apos;s language, and a dashboard
              where your team reviews, documents and settles them.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
                Create a free account
              </Link>
              <Link href="/docs" className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 hover:border-gray-400">
                Read the docs
              </Link>
            </div>
            <p className="mt-4 text-sm text-gray-500">No credit card. Bring your own WhatsApp number and AI key.</p>
          </div>
          <Screenshot id="claimDetail" priority sizes="(min-width: 1024px) 700px, 100vw" className="lg:my-0" />
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="problem-title">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">The problem</p>
          <h2 id="problem-title" className="mt-2 text-3xl font-bold tracking-tight text-gray-900">Claims start where your customers are, and today that is WhatsApp</h2>
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {PROBLEMS.map((p) => (
            <div key={p.title} className="rounded-2xl border border-gray-200 p-6">
              <h3 className="font-semibold text-gray-900">{p.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{p.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Solution */}
      <section className="bg-gray-950 text-white" aria-labelledby="solution-title">
        <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wider text-emerald-400">The solution</p>
            <h2 id="solution-title" className="mt-2 text-3xl font-bold tracking-tight">A claims desk that answers in seconds, in any language</h2>
            <p className="mt-4 text-gray-300">
              The assistant greets the customer, recognises returning clients, asks the questions you configured for each type of coverage and collects photos and
              documents. When the file is complete, it creates the claim, sends a confirmation and hands the case to your team.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-gray-300">
              <li className="flex gap-3"><span className="text-emerald-400" aria-hidden="true">✓</span> Complete claims instead of scattered messages</li>
              <li className="flex gap-3"><span className="text-emerald-400" aria-hidden="true">✓</span> Every conversation and document in one place</li>
              <li className="flex gap-3"><span className="text-emerald-400" aria-hidden="true">✓</span> Your data on your servers if you self-host</li>
            </ul>
          </div>
          <Screenshot id="conversation" sizes="(min-width: 1024px) 600px, 100vw" />
        </div>
      </section>

      {/* Features */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="features-title">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">Features</p>
          <h2 id="features-title" className="mt-2 text-3xl font-bold tracking-tight text-gray-900">Everything a claims team needs, nothing it doesn&apos;t</h2>
        </div>
        <div className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-2xl border border-gray-200 p-6">
              <div className="text-2xl" aria-hidden="true">{f.icon}</div>
              <h3 className="mt-3 font-semibold text-gray-900">{f.title}</h3>
              <p className="mt-2 text-sm leading-6 text-gray-600">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-gray-200 bg-gray-50" aria-labelledby="steps-title">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">How it works</p>
          <h2 id="steps-title" className="mt-2 text-3xl font-bold tracking-tight text-gray-900">Live in an afternoon</h2>
          <ol className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <li key={s.title} className="rounded-2xl border border-gray-200 bg-white p-6">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">{i + 1}</span>
                <h3 className="mt-4 font-semibold text-gray-900">{s.title}</h3>
                <p className="mt-2 text-sm leading-6 text-gray-600">{s.text}</p>
                <Link href={s.href} className="mt-3 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-600">Learn how →</Link>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Screenshots */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6" aria-labelledby="tour-title">
        <p className="text-sm font-semibold uppercase tracking-wider text-emerald-700">Product tour</p>
        <h2 id="tour-title" className="mt-2 text-3xl font-bold tracking-tight text-gray-900">See every claim, every customer, every message</h2>
        <div className="mt-8 grid gap-8 lg:grid-cols-2">
          <Screenshot id="home" caption="Dashboard: claims and conversations at a glance" sizes="(min-width: 1024px) 600px, 100vw" />
          <Screenshot id="claims" caption="Every claim and its status at a glance" sizes="(min-width: 1024px) 600px, 100vw" />
          <Screenshot id="client" caption="A returning client and both of their claims" sizes="(min-width: 1024px) 600px, 100vw" />
          <Screenshot id="settingsWhatsapp" caption="Connect your WhatsApp Business number in Settings" sizes="(min-width: 1024px) 600px, 100vw" />
        </div>
        <p className="mt-4 text-center text-xs text-gray-500">Screenshots from a demo company with fictional customers.</p>
      </section>

      {/* Open source */}
      <section className="mx-auto max-w-7xl px-4 pb-16 sm:px-6" aria-labelledby="oss-title">
        <div className="grid items-center gap-10 rounded-3xl bg-emerald-900 px-6 py-12 text-white sm:px-12 lg:grid-cols-2">
          <div>
            <h2 id="oss-title" className="text-3xl font-bold tracking-tight">Open source. Host it yourself, or let us.</h2>
            <p className="mt-4 text-emerald-100">
              The full product is open source. Run it on your own server with one Docker Compose command and keep customer data in your country, or{' '}
              <Link href="/contact" className="font-semibold text-white underline">contact us</Link> to have us host it, with updates and backups handled for you.
            </p>
            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/docs/self-hosting" className="rounded-lg bg-white px-5 py-3 text-sm font-semibold text-emerald-900 hover:bg-emerald-50">Self-hosting guide</Link>
              <Link href="/pricing" className="rounded-lg border border-emerald-300 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800">See pricing</Link>
              <a href={SITE.githubUrl} className="rounded-lg border border-emerald-300 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-800" rel="noopener noreferrer" target="_blank">GitHub</a>
            </div>
          </div>
          <pre className="overflow-x-auto rounded-xl bg-emerald-950 p-5 text-sm leading-relaxed text-emerald-100"><code>{`git clone ${SITE.githubUrl}.git rapidos
cd rapidos && cp .env.example .env
docker compose up -d --build
# open http://localhost:3000/signup`}</code></pre>
        </div>
      </section>

      {/* Final CTA */}
      <section className="border-t border-gray-200 bg-gray-50">
        <div className="mx-auto max-w-3xl px-4 py-16 text-center sm:px-6">
          <h2 className="text-3xl font-bold tracking-tight text-gray-900">Ready to take your first claim on WhatsApp?</h2>
          <p className="mt-4 text-gray-600">Create your company account in a few minutes. You can connect WhatsApp and your AI provider afterwards.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="rounded-lg bg-emerald-600 px-5 py-3 text-sm font-semibold text-white hover:bg-emerald-500">Create account</Link>
            <Link href="/docs/getting-started" className="rounded-lg border border-gray-300 bg-white px-5 py-3 text-sm font-semibold text-gray-900 hover:border-gray-400">Getting started guide</Link>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
