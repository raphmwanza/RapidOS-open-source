'use client';

import Link from 'next/link';
import { useI18n } from './I18nProvider';
import type { TranslationKey } from '@/lib/i18n';

/** Shown instead of an admin-only page; the matching APIs return 403 as well. */
export default function NoAccess({ role }: { role?: string | null }) {
  const { t } = useI18n();
  const roleLabel = role ? t(`nav.role.${role}` as TranslationKey) : t('nav.role.user');
  return (
    <div className="flex min-h-screen items-center justify-center px-6" style={{ backgroundColor: '#F1F3F4' }}>
      <div className="max-w-md rounded-2xl border bg-white p-8 text-center shadow-sm" data-testid="no-access">
        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-2xl" aria-hidden>🔒</div>
        <h1 className="mt-4 text-2xl font-bold text-gray-900">{t('nav.noAccess.title')}</h1>
        <p className="mt-2 text-sm text-gray-600">{t('nav.noAccess.body', { role: roleLabel })}</p>
        <Link href="/home" className="mt-6 inline-block rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-black">{t('nav.noAccess.back')}</Link>
      </div>
    </div>
  );
}
