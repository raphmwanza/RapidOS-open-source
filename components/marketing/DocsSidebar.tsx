'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState } from 'react';
import { DOCS_NAV } from '@/lib/marketing/docsNav';

/** Docs navigation: a sticky sidebar on desktop, a collapsible menu on mobile. */
export default function DocsSidebar({ apiSections }: { apiSections: Array<{ id: string; title: string }> }) {
  const pathname = usePathname() || '/docs';
  const [open, setOpen] = useState(false);
  const current = DOCS_NAV.find((i) => i.href === pathname) ?? DOCS_NAV[0];

  const list = (
    <ul className="space-y-1">
      {DOCS_NAV.map((item) => {
        const active = item.href === pathname;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={() => setOpen(false)}
              aria-current={active ? 'page' : undefined}
              className={`block rounded-md px-3 py-2 text-sm ${active ? 'bg-emerald-50 font-semibold text-emerald-800' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'}`}
            >
              {item.title}
            </Link>
            {active && item.href === '/docs/api' && (
              <ul className="mb-2 ml-3 mt-1 space-y-0.5 border-l border-gray-200 pl-3">
                {apiSections.map((g) => (
                  <li key={g.id}>
                    <a href={`#${g.id}`} onClick={() => setOpen(false)} className="block py-1 text-xs text-gray-600 hover:text-emerald-700">{g.title}</a>
                  </li>
                ))}
              </ul>
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <>
      <div className="mb-6 lg:hidden">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-controls="docs-mobile-nav"
          className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-800"
        >
          <span>Docs: {current.title}</span>
          <svg className={`h-4 w-4 transition-transform ${open ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 9l6 6 6-6" />
          </svg>
        </button>
        {open && <nav id="docs-mobile-nav" aria-label="Documentation" className="mt-2 rounded-lg border border-gray-200 bg-white p-2">{list}</nav>}
      </div>
      <nav aria-label="Documentation" className="sticky top-24 hidden max-h-[calc(100vh-7rem)] overflow-y-auto pb-8 lg:block">
        <p className="mb-3 px-3 text-xs font-semibold uppercase tracking-wider text-gray-500">Documentation</p>
        {list}
      </nav>
    </>
  );
}
