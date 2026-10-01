'use client';

import { useI18n } from './I18nProvider';

interface HelpLinkProps {
  href: string;
  /** Defaults to the translated "Help". */
  label?: string;
  icon?: 'help' | 'api';
  testId?: string;
  className?: string;
}

/**
 * Small "Help" link from a dashboard card to the matching docs section. Opens in a new
 * tab so a half-filled form is not lost. The docs are in English (title says so).
 */
export default function HelpLink({ href, label, icon = 'help', testId, className = '' }: HelpLinkProps) {
  const { t } = useI18n();
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={t('nav.docsTitle')}
      data-testid={testId}
      className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:border-emerald-300 hover:bg-emerald-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 ${className}`}
    >
      {icon === 'api' ? (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 9l-4 3 4 3M16 9l4 3-4 3M14 5l-4 14" />
        </svg>
      ) : (
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01" />
        </svg>
      )}
      <span>{label ?? t('help.link')}</span>
    </a>
  );
}
