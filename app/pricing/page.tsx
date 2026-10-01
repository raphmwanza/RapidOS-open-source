import Link from 'next/link';
import MarketingShell from '@/components/marketing/MarketingShell';
import { pageMetadata } from '@/lib/marketing/metadata';
import { CONTACT_EMAIL, PRICING_FAQ, PRICING_PLANS } from '@/config/pricing';

export const metadata = pageMetadata({
  title: 'Pricing',
  description: 'RapidOS is free and open source to self-host. Contact us for hosting, enterprise needs, setup and support.',
  path: '/pricing',
});

function Check() {
  return (
    <svg className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
      <path fillRule="evenodd" d="M16.7 5.3a1 1 0 010 1.4l-7.5 7.5a1 1 0 01-1.4 0L3.3 9.7a1 1 0 111.4-1.4l3.8 3.8 6.8-6.8a1 1 0 011.4 0z" clipRule="evenodd" />
    </svg>
  );
}

export default function PricingPage() {
  return (
    <MarketingShell>
      <section className="bg-gradient-to-b from-emerald-50 to-white">
        <div className="mx-auto max-w-7xl px-4 pb-12 pt-16 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Simple pricing</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            The software is free and open source. Contact us if you want us to host it, set it up or support your team.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6" aria-label="Plans">
        <div className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
          {PRICING_PLANS.map((plan) => {
            return (
              <div
                key={plan.id}
                className={`relative flex flex-col rounded-2xl border p-6 ${plan.highlighted ? 'border-emerald-500 shadow-xl shadow-emerald-900/10 ring-1 ring-emerald-500' : 'border-gray-200'}`}
              >
                <h2 className="text-lg font-semibold text-gray-900">{plan.name}</h2>
                <p className="mt-2 min-h-[3rem] text-sm text-gray-600">{plan.description}</p>
                <div className="mt-6 flex items-baseline gap-2">
                  <span className="text-4xl font-bold tracking-tight text-gray-900">{plan.headline}</span>
                </div>
                <p className="mt-1 text-sm text-gray-500">{plan.note}</p>
                <ul className="mt-6 flex-1 space-y-3 text-sm text-gray-700">
                  {plan.features.map((f) => (
                    <li key={f} className="flex gap-2"><Check />{f}</li>
                  ))}
                </ul>
                {plan.cta.href.startsWith('mailto:') ? (
                  <a href={plan.cta.href} className="mt-8 block rounded-lg border border-gray-300 px-4 py-2.5 text-center text-sm font-semibold text-gray-900 hover:border-gray-400">{plan.cta.label}</a>
                ) : (
                  <Link
                    href={plan.cta.href}
                    className={`mt-8 block rounded-lg px-4 py-2.5 text-center text-sm font-semibold ${plan.highlighted ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'border border-gray-300 text-gray-900 hover:border-gray-400'}`}
                  >
                    {plan.cta.label}
                  </Link>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-6 text-center text-sm text-gray-500">
          WhatsApp conversation fees are billed by Meta and AI usage by your AI provider. No payment is taken on this site.
        </p>
      </section>

      <section className="border-t border-gray-200 bg-gray-50" aria-labelledby="faq-title">
        <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
          <h2 id="faq-title" className="text-center text-3xl font-bold tracking-tight text-gray-900">Frequently asked questions</h2>
          <div className="mt-10 space-y-4">
            {PRICING_FAQ.map((item) => (
              <details key={item.q} className="group rounded-xl border border-gray-200 bg-white p-5 open:shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 font-semibold text-gray-900">
                  <h3 className="text-base">{item.q}</h3>
                  <span className="text-gray-400 transition group-open:rotate-45" aria-hidden="true">+</span>
                </summary>
                <p className="mt-3 text-sm leading-6 text-gray-600">{item.a}</p>
              </details>
            ))}
          </div>
          <p className="mt-10 text-center text-sm text-gray-600">
            Another question? Use the <Link href="/contact" className="font-semibold text-emerald-700 hover:underline">contact form</Link>, write to{' '}
            <a href={`mailto:${CONTACT_EMAIL}`} className="font-semibold text-emerald-700 hover:underline">{CONTACT_EMAIL}</a> or read the{' '}
            <Link href="/docs" className="font-semibold text-emerald-700 hover:underline">documentation</Link>.
          </p>
        </div>
      </section>
    </MarketingShell>
  );
}
