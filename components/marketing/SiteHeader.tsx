'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { SITE } from '@/config/site';
import { AUTH_CHANGE_EVENT, hasAccessToken } from '@/lib/authEvents';

const NAV = [
  { href: '/', label: 'Home' },
  { href: '/docs', label: 'Docs' },
  { href: '/pricing', label: 'Pricing' },
  { href: '/contact', label: 'Contact' },
];

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname === href || pathname.startsWith(`${href}/`);
}

/** Signed in on this browser (access token stored). Read after mount, so the server HTML is the signed-out header. */
function useSignedIn(pathname: string): boolean {
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    const update = () => setSignedIn(hasAccessToken());
    update();
    window.addEventListener(AUTH_CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      window.removeEventListener(AUTH_CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [pathname]);
  return signedIn;
}

/** Shared header of the marketing site (landing, docs, pricing). English only. */
export default function SiteHeader() {
  const pathname = usePathname() || '/';
  const [open, setOpen] = useState(false);
  const signedIn = useSignedIn(pathname);

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6" aria-label="Main">
        <Link href="/" className="flex items-center gap-2 font-bold text-gray-900" onClick={() => setOpen(false)}>
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-600 text-sm font-black text-white">R</span>
          <span className="text-lg tracking-tight">{SITE.name}</span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`rounded-md px-3 py-2 text-sm font-medium ${isActive(pathname, item.href) ? 'text-emerald-700' : 'text-gray-600 hover:text-gray-900'}`}
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
          <a href={SITE.githubUrl} className="rounded-md px-3 py-2 text-sm font-medium text-gray-600 hover:text-gray-900" rel="noopener noreferrer" target="_blank">
            GitHub
          </a>
        </div>

        <div className="hidden items-center gap-3 md:flex">
          {signedIn ? (
            <Link href="/home" data-testid="go-to-dashboard" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
              Go to dashboard
            </Link>
          ) : (
            <>
              <Link href="/login" className="text-sm font-semibold text-gray-700 hover:text-gray-900">Log in</Link>
              <Link href="/signup" className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-emerald-500">
                Create account
              </Link>
            </>
          )}
        </div>

        <button
          type="button"
          className="inline-flex h-10 w-10 items-center justify-center rounded-md text-gray-700 hover:bg-gray-100 md:hidden"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          aria-controls="site-mobile-menu"
          onClick={() => setOpen((v) => !v)}
        >
          <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            {open ? <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /> : <path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </nav>

      {open && (
        <div id="site-mobile-menu" className="border-t border-gray-200 bg-white px-4 pb-4 pt-2 md:hidden">
          {NAV.map((item) => (
            <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`block rounded-md px-3 py-2 text-base font-medium ${isActive(pathname, item.href) ? 'bg-emerald-50 text-emerald-700' : 'text-gray-700 hover:bg-gray-50'}`}>
              {item.label}
            </Link>
          ))}
          <a href={SITE.githubUrl} className="block rounded-md px-3 py-2 text-base font-medium text-gray-700 hover:bg-gray-50" rel="noopener noreferrer" target="_blank">GitHub</a>
          {signedIn ? (
            <Link href="/home" onClick={() => setOpen(false)} data-testid="go-to-dashboard-mobile" className="mt-3 block rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white">
              Go to dashboard
            </Link>
          ) : (
            <div className="mt-3 grid grid-cols-2 gap-3">
              <Link href="/login" onClick={() => setOpen(false)} className="rounded-lg border border-gray-300 px-4 py-2 text-center text-sm font-semibold text-gray-800">Log in</Link>
              <Link href="/signup" onClick={() => setOpen(false)} className="rounded-lg bg-emerald-600 px-4 py-2 text-center text-sm font-semibold text-white">Create account</Link>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
