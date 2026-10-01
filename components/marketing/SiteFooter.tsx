import Link from 'next/link';
import { SITE } from '@/config/site';

const COLUMNS = [
  {
    title: 'Product',
    links: [
      { href: '/', label: 'Home' },
      { href: '/pricing', label: 'Pricing' },
      { href: '/contact', label: 'Contact us' },
      { href: '/signup', label: 'Create account' },
      { href: '/login', label: 'Log in' },
    ],
  },
  {
    title: 'Documentation',
    links: [
      { href: '/docs/getting-started', label: 'Getting started' },
      { href: '/docs/whatsapp', label: 'WhatsApp setup' },
      { href: '/docs/ai-providers', label: 'AI providers' },
      { href: '/docs/self-hosting', label: 'Self-hosting' },
      { href: '/docs/api', label: 'API reference' },
    ],
  },
];

/** Shared footer of the marketing site. */
export default function SiteFooter() {
  return (
    <footer className="border-t border-gray-200 bg-gray-50">
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 md:grid-cols-4">
        <div className="md:col-span-2">
          <div className="flex items-center gap-2 font-bold text-gray-900">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">R</span>
            <span className="text-lg">{SITE.name}</span>
          </div>
          <p className="mt-4 max-w-md text-sm text-gray-600">{SITE.description}</p>
          <a href={SITE.githubUrl} className="mt-4 inline-block text-sm font-semibold text-emerald-700 hover:text-emerald-600" rel="noopener noreferrer" target="_blank">
            Source code on GitHub →
          </a>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.title}>
            <h2 className="text-sm font-semibold text-gray-900">{col.title}</h2>
            <ul className="mt-4 space-y-2">
              {col.links.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className="text-sm text-gray-600 hover:text-gray-900">{l.label}</Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-gray-200 py-6 text-center text-xs text-gray-500">
        <p>
          {SITE.copyright}. {SITE.name} is free software under the{' '}
          <a href={`${SITE.githubUrl}/blob/main/LICENSE`} className="font-semibold text-emerald-700 hover:underline" rel="noopener noreferrer license" target="_blank" data-testid="footer-license">
            {SITE.license}
          </a>{' '}
          license.{' '}
          <a href={SITE.githubUrl} className="font-semibold text-emerald-700 hover:underline" rel="noopener noreferrer" target="_blank">Get the source code</a>.
        </p>
        <p className="mt-1">The {SITE.name} name and logo are not covered by the license. WhatsApp is a trademark of Meta Platforms, Inc.</p>
      </div>
    </footer>
  );
}
