'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import LogoutButton from './LogoutButton';
import LanguageSwitcher from './LanguageSwitcher';
import { isPublicPath } from './AuthProvider';
import { useI18n } from './I18nProvider';
import { authedFetch } from '@/lib/authedFetch';
import { localeDir, normalizeLocale, type TranslationKey } from '@/lib/i18n';
import { isMarketingPath } from '@/lib/marketing/paths';
import { USER_ROLES, isAdminRole } from '@/lib/users/roles';
import { CurrentUserContext, currentUserFromRole } from './CurrentUser';
import { HELP_LINKS } from '@/lib/helpLinks';

interface LayoutWrapperProps {
  children: React.ReactNode;
}

export default function LayoutWrapper({ children }: LayoutWrapperProps) {
  const pathname = usePathname();
  const { t, locale, setLocale } = useI18n();
  // Landing, login and signup render full-screen without the dashboard chrome.
  const isLoginPage = isPublicPath(pathname);
  const isMarketing = isMarketingPath(pathname);

  // The marketing site is English only; the dashboard follows the UI language
  // (also when navigating between them without a full page load).
  useEffect(() => {
    document.documentElement.lang = isMarketing ? 'en' : locale;
    document.documentElement.dir = isMarketing ? 'ltr' : localeDir(locale);
  }, [isMarketing, locale]);
  const [userNameInitial, setUserNameInitial] = useState<string>('A');
  const [role, setRole] = useState<string>('');
  const [fullName, setFullName] = useState<string>('');

  useEffect(() => {
    if (isLoginPage) return; // Don't fetch profile on public pages
    let cancelled = false;
    (async () => {
      try {
        const res = await authedFetch('/api/auth/profile');
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const user = data?.user;
        const first = (user?.firstName || '').trim();
        const last = (user?.lastName || '').trim();
        const initial = (first || last || 'A').charAt(0).toUpperCase();
        setUserNameInitial(initial);
        setFullName(`${first} ${last}`.trim());
        setRole((user?.role || '').toUpperCase());
        // Account language (personal override, else company default) wins over the browser choice.
        const preferred = normalizeLocale(user?.uiLanguage);
        if (preferred && preferred !== locale) setLocale(preferred);
      } catch {
        // ignore fetch errors; keep defaults
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginPage]);

  const roleKey = `nav.role.${role}` as TranslationKey;
  const roleLabel = (USER_ROLES as readonly string[]).includes(role) ? t(roleKey) : t('nav.role.user');
  // Settings and Users are admin-only (pages and APIs enforce it too).
  const showAdminLinks = isAdminRole(role);
  // Pages read this to hide edit/create/delete controls from read-only roles.
  const currentUser = useMemo(() => currentUserFromRole(role), [role]);

  // Below the md breakpoint the sidebar is an off-canvas menu opened from the top bar.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => { setMenuOpen(false); }, [pathname]);
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const helpIcon = (
    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
    </svg>
  );
  const docsButton = (testId: string) => (
    <Link
      href={HELP_LINKS.docs}
      aria-label={t('nav.docs')}
      title={t('nav.docsTitle')}
      data-testid={testId}
      className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-gray-700 text-white hover:bg-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
    >
      {helpIcon}
    </Link>
  );

  if (isLoginPage) {
    // Return children without sidebar for login page
    return <>{children}</>;
  }

  // Return full layout with sidebar for authenticated pages
  return (
    <div className="flex h-screen" style={{ background: '#535353' }}>
      {/* Mobile menu backdrop */}
      {menuOpen && <div className="fixed inset-0 z-40 bg-black/50 md:hidden" onClick={() => setMenuOpen(false)} aria-hidden="true" />}

      {/* Sidebar: always shown from md up, an off-canvas menu below */}
      <div
        id="dashboard-sidebar"
        data-testid="dashboard-sidebar"
        className={`${menuOpen ? 'fixed inset-y-0 start-0 z-50 flex' : 'hidden'} w-64 shrink-0 overflow-y-auto text-white p-5 shadow-xl border-e-2 border-gray-500 flex-col md:relative md:z-auto md:flex`}
        style={{ background: '#202124' }}
        onClick={(e) => { if ((e.target as HTMLElement).closest('a')) setMenuOpen(false); }}
      >
        <button
          type="button"
          onClick={() => setMenuOpen(false)}
          aria-label={t('nav.closeMenu')}
          className="absolute top-3 end-3 inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-300 hover:bg-gray-700 hover:text-white md:hidden"
        >
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" /></svg>
        </button>
        {/* Logo and Title */}
        <div className="flex items-center mb-8">
          <img src="/assets/images/icon.png" alt="Logo" className="h-50 w-auto" />
        </div>
        
        {/* Navigation */}
        <nav className="space-y-2">
          <Link 
            href="/home" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/home' 
                ? 'bg-blue-600 bg-opacity-20 text-white border-blue-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-blue-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
            {t('nav.dashboard')}
          </Link>
          <Link 
            href="/conversations" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/conversations' 
                ? 'bg-green-600 bg-opacity-20 text-white border-green-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-green-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
            {t('nav.conversations')}
          </Link>
          <Link 
            href="/analysis" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/analysis' 
                ? 'bg-purple-600 bg-opacity-20 text-white border-purple-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-purple-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
            </svg>
            {t('nav.analysis')}
          </Link>
          <Link 
            href="/clients" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/clients' 
                ? 'bg-orange-600 bg-opacity-20 text-white border-orange-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-orange-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197m13.5-9a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0z" />
            </svg>
            {t('nav.clients')}
          </Link>
          <Link 
            href="/claims" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/claims' 
                ? 'bg-red-600 bg-opacity-20 text-white border-red-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-red-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            {t('nav.claims')}
          </Link>
          {showAdminLinks && (
            <>
          <Link
            href="/users"
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/users'
                ? 'bg-teal-600 bg-opacity-20 text-white border-teal-400 shadow-lg'
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-teal-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            {t('nav.users')}
          </Link>
          <Link 
            href="/settings" 
            className={`flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 ${
              pathname === '/settings' 
                ? 'bg-gray-600 bg-opacity-20 text-white border-gray-400 shadow-lg' 
                : 'hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-gray-400'
            }`}
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            {t('nav.settings')}
          </Link>
            </>
          )}
        </nav>

        {/* Documentation (marketing site, English); its header links back to the dashboard */}
        <div className="mt-4 border-t border-gray-700 pt-4">
          <Link
            href={HELP_LINKS.docs}
            title={t('nav.docsTitle')}
            data-testid="nav-docs"
            className="flex items-center py-3 px-4 rounded-lg transition duration-200 border-s-4 hover:bg-gray-700 hover:bg-opacity-50 text-gray-200 hover:text-white border-transparent hover:border-emerald-400"
          >
            <svg className="w-5 h-5 me-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
            </svg>
            {t('nav.docs')}
          </Link>
        </div>
        
        {/* Dashboard language (saved as this user's preference) */}
        <div className="mt-auto flex items-center justify-between gap-2 pt-6 text-xs text-gray-400">
          <span>{t('common.language')}</span>
          <LanguageSwitcher persistToAccount variant="dark" />
        </div>
        {/* User Info (mobile menu); from md up it is the fixed card below */}
        <div className="mt-4 border-t border-gray-700 pt-4 md:hidden" data-testid="mobile-user-menu">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold text-white" style={{ background: 'linear-gradient(90deg,#34d399,#f59e0b)' }}>{userNameInitial}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-white">{fullName || roleLabel}</p>
              <p className="truncate text-xs text-gray-300">{roleLabel}</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            {docsButton('user-menu-docs-mobile')}
            <LogoutButton />
          </div>
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Mobile top bar */}
        <div className="flex h-14 shrink-0 items-center justify-between gap-3 px-3 text-white md:hidden" style={{ background: '#202124' }} data-testid="mobile-topbar">
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t('nav.openMenu')}
            aria-expanded={menuOpen}
            aria-controls="dashboard-sidebar"
            data-testid="mobile-menu-button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md hover:bg-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true"><path strokeLinecap="round" d="M4 7h16M4 12h16M4 17h16" /></svg>
          </button>
          <Image src="/assets/images/icon.png" alt="Logo" width={1080} height={610} className="h-8 w-auto" priority />
          {docsButton('mobile-topbar-docs')}
        </div>

        {/* Main Content */}
        <main className="flex-1 overflow-y-auto">
          <CurrentUserContext.Provider value={currentUser}>{children}</CurrentUserContext.Provider>
        </main>
      </div>

      {/* Fixed bottom-right user card with viewport-based width (1/7 of viewport), from md up */}
      <div className="fixed bottom-5 z-50 hidden md:block" style={{ insetInlineEnd: '3%' }}>
        <div
          className="bg-gray-800 bg-opacity-50 rounded-lg p-[2%]"
          style={{ width: '14.2857vw' }}
        >
          <div className="flex items-center justify-start gap-[4%] w-full">
            <div className="flex items-center min-w-0 flex-1">
              <div className="rounded-full flex items-center justify-center text-white font-bold shrink-0"
                   style={{ width: '12%', height: '12%', minWidth: '28px', minHeight: '28px', background: 'linear-gradient(90deg,#34d399,#f59e0b)' }}>
                <span className="text-[clamp(10px,0.9vw,12px)]">{userNameInitial}</span>
              </div>
              <div className="ms-[4%] truncate">
                <p className="font-medium text-white truncate text-[clamp(12px,1.0vw,14px)]">{fullName || roleLabel}</p>
                <p className="text-gray-300 truncate text-[clamp(11px,0.9vw,13px)]">{roleLabel}</p>
              </div>
            </div>
            <div className="shrink-0 ms-auto flex items-center gap-2">
              {docsButton('user-menu-docs')}
              <LogoutButton />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
