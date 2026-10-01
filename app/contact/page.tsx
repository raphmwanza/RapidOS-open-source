import MarketingShell from '@/components/marketing/MarketingShell';
import ContactForm from '@/components/marketing/ContactForm';
import { pageMetadata } from '@/lib/marketing/metadata';
import { SITE } from '@/config/site';

export const metadata = pageMetadata({
  title: 'Contact us',
  description: 'Hosting, enterprise needs, setup or support for RapidOS: tell us about your insurance company and we get back to you.',
  path: '/contact',
});

export default function ContactPage() {
  return (
    <MarketingShell>
      <section className="bg-gradient-to-b from-emerald-50 to-white">
        <div className="mx-auto max-w-3xl px-4 pb-8 pt-16 text-center sm:px-6">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-5xl">Contact us</h1>
          <p className="mx-auto mt-4 max-w-2xl text-lg text-gray-600">
            Want us to host RapidOS, help you set it up or support your claims team? Tell us about your company and we reply
            with a proposal. You can also write to{' '}
            <a href={`mailto:${SITE.contactEmail}`} className="font-semibold text-emerald-700 hover:underline">{SITE.contactEmail}</a>.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-3xl px-4 pb-20 sm:px-6" aria-label="Contact form">
        <ContactForm />
      </section>
    </MarketingShell>
  );
}
