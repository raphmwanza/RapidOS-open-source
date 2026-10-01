import type { TranslationKey, TranslationVars } from './index';

type T = (key: TranslationKey, vars?: TranslationVars) => string;

export const CLAIM_STATUSES = ['NEW', 'ONGOING', 'APPROVED', 'REJECTED', 'COMPLETED'] as const;
const STATUSES = CLAIM_STATUSES;
const TYPES = ['AUTO', 'HOME', 'LIFE', 'HEALTH', 'FIRE', 'TRAVEL', 'BUSINESS', 'TRANSPORT', 'CONSTRUCTION', 'OTHER'] as const;

/** Localized claim status; unknown values are shown as-is. */
export function claimStatusLabel(t: T, status: string | null | undefined): string {
  const s = String(status || '').toUpperCase();
  return (STATUSES as readonly string[]).includes(s) ? t(`claim.status.${s}` as TranslationKey) : String(status || '');
}

/** Localized claim type/category; unknown values are shown as-is. */
export function claimTypeLabel(t: T, type: string | null | undefined): string {
  const s = String(type || '').toUpperCase();
  return (TYPES as readonly string[]).includes(s) ? t(`claim.type.${s}` as TranslationKey) : String(type || '');
}
