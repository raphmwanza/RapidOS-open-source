'use client';

import { LOCALE_REGISTRY, localeLabel, normalizeLocale, type Locale } from '@/lib/i18n';

interface LanguageSelectProps {
  value: Locale | '';
  onChange: (next: Locale | '') => void;
  /** When set, adds a first option with an empty value (e.g. "Company default"). */
  emptyLabel?: string;
  id?: string;
  name?: string;
  className?: string;
  disabled?: boolean;
  'aria-label'?: string;
  'data-testid'?: string;
}

/** Dropdown of every language in the locale registry (lib/i18n/locales.ts). */
export default function LanguageSelect({ value, onChange, emptyLabel, className = '', ...rest }: LanguageSelectProps) {
  return (
    <select
      {...rest}
      className={className}
      value={value}
      onChange={(e) => onChange(e.target.value === '' ? '' : (normalizeLocale(e.target.value) ?? ''))}
    >
      {emptyLabel !== undefined && <option value="">{emptyLabel}</option>}
      {LOCALE_REGISTRY.map((l) => (
        <option key={l.code} value={l.code} lang={l.code} dir={l.dir}>
          {localeLabel(l.code)}
        </option>
      ))}
    </select>
  );
}
