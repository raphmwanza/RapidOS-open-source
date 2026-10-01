'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isMarketingPath } from '@/lib/marketing/paths';
import {
  LOCALE_COOKIE,
  LOCALE_STORAGE_KEY,
  hasMessages,
  intlLocale,
  loadMessages,
  localeDir,
  normalizeLocale,
  registerMessages,
  translate,
  type Locale,
  type Messages,
  type TranslationKey,
  type TranslationVars,
} from '@/lib/i18n';

interface I18nContextValue {
  locale: Locale;
  /** Text direction of the current locale. */
  dir: 'ltr' | 'rtl';
  /** Changes the UI language for this browser (cookie + localStorage), loading its dictionary first. */
  setLocale: (locale: Locale) => Promise<void>;
  t: (key: TranslationKey, vars?: TranslationVars) => string;
  /** BCP 47 tag for Intl formatting (e.g. toLocaleDateString). */
  intl: string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function persistLocale(locale: Locale) {
  try {
    document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
  } catch {
    // Storage can be unavailable (private mode); the in-memory locale still applies.
  }
  // Marketing pages (landing, docs, pricing) stay English: see lib/marketing/paths.ts.
  if (isMarketingPath(window.location.pathname)) return;
  document.documentElement.lang = locale;
  document.documentElement.dir = localeDir(locale);
}

interface I18nProviderProps {
  initialLocale: Locale;
  /** Dictionary of initialLocale, rendered by the server (omitted for English). */
  initialMessages?: Messages;
  hasCookie: boolean;
  children: React.ReactNode;
}

export default function I18nProvider({ initialLocale, initialMessages, hasCookie, children }: I18nProviderProps) {
  // Register before the first render so translate() finds the server-provided strings.
  const registered = useRef(false);
  if (!registered.current && initialMessages) {
    registerMessages(initialLocale, initialMessages);
    registered.current = true;
  }
  const [locale, setLocaleState] = useState<Locale>(initialLocale);
  const pending = useRef<Locale | null>(null);

  const setLocale = useCallback(async (next: Locale) => {
    pending.current = next;
    if (!hasMessages(next)) await loadMessages(next);
    // Ignore a slower load if another language was picked meanwhile.
    if (pending.current !== next) return;
    setLocaleState(next);
    persistLocale(next);
  }, []);

  useEffect(() => {
    // No cookie yet: fall back to a previous choice stored in this browser.
    if (hasCookie) return;
    let stored: Locale | null = null;
    try {
      stored = normalizeLocale(window.localStorage.getItem(LOCALE_STORAGE_KEY));
    } catch {
      stored = null;
    }
    if (stored && stored !== locale) void setLocale(stored);
    else persistLocale(locale);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    dir: localeDir(locale),
    setLocale,
    t: (key, vars) => translate(locale, key, vars),
    intl: intlLocale(locale),
  }), [locale, setLocale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}
