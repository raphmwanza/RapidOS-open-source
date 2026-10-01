'use client';

import { useState } from 'react';
import { useI18n } from '@/components/I18nProvider';
import LanguageSelect from '@/components/LanguageSelect';
import type { Locale } from '@/lib/i18n';
import { authedFetch } from '@/lib/authedFetch';

interface LanguageSwitcherProps {
  /** Also save the choice as the signed-in user's personal preference. */
  persistToAccount?: boolean;
  variant?: 'light' | 'dark';
  className?: string;
}

/** Compact UI-language dropdown (login, signup, sidebar), driven by the locale registry. */
export default function LanguageSwitcher({ persistToAccount = false, variant = 'light', className = '' }: LanguageSwitcherProps) {
  const { locale, setLocale, t } = useI18n();
  const [busy, setBusy] = useState(false);

  const choose = async (next: Locale | '') => {
    if (!next || next === locale || busy) return;
    setBusy(true);
    try {
      await setLocale(next);
      if (persistToAccount) {
        await authedFetch('/api/auth/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uiLanguage: next }),
        });
      }
    } catch {
      // The browser-level choice still applies even if saving the preference fails.
    } finally {
      setBusy(false);
    }
  };

  const base = variant === 'dark'
    ? 'border-gray-600 bg-gray-800/80 text-gray-100'
    : 'border-gray-200 bg-white/90 text-gray-700 shadow-sm';

  return (
    <label className={`inline-flex items-center gap-1.5 rounded-full border py-0.5 ps-2.5 pe-1 text-xs font-semibold ${base} ${className}`}>
      <span aria-hidden="true">🌐</span>
      <span className="sr-only">{t('common.language')}</span>
      <LanguageSelect
        value={locale}
        onChange={choose}
        disabled={busy}
        aria-label={t('common.language')}
        data-testid="language-switcher"
        className={`max-w-[11rem] cursor-pointer truncate rounded-full border-0 bg-transparent py-1 pe-1 text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-400 ${variant === 'dark' ? '[&>option]:text-gray-900' : ''}`}
      />
    </label>
  );
}
