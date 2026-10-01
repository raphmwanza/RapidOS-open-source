/**
 * Locale registry: the single list of languages the dashboard and the
 * WhatsApp assistant support.
 *
 * Adding a language:
 *   1. Add an entry below.
 *   2. Add `lib/i18n/locales/<code>.json` (dashboard strings; missing keys fall back to English).
 *   3. Add `backend/internal/service/botlocales/<code>.json` (WhatsApp bot messages).
 *   4. Run `npm run check:locales`.
 * See "Adding a language" in the README.
 */
export interface LocaleDefinition {
  /** ISO 639-1 code (or 639-2/3 when there is no 2-letter code). Stored in the database. */
  code: string;
  /** English name, used in prompts ("reply in Swahili") and for sorting. */
  name: string;
  /** Name in the language itself, shown in language pickers. */
  nativeName: string;
  dir: 'ltr' | 'rtl';
  /** BCP 47 tag for Intl date/number formatting. */
  intl: string;
  /** True when a native speaker reviewed the translations. Others are machine-translated. */
  reviewed: boolean;
  /** Where the language is mainly used (documentation only). */
  regions?: string;
}

export const LOCALE_REGISTRY = [
  { code: 'en', name: 'English', nativeName: 'English', dir: 'ltr', intl: 'en-US', reviewed: true },
  { code: 'fr', name: 'French', nativeName: 'Français', dir: 'ltr', intl: 'fr-FR', reviewed: true, regions: 'DRC, West and Central Africa, France' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português', dir: 'ltr', intl: 'pt', reviewed: false, regions: 'Angola, Mozambique, Brazil' },
  { code: 'es', name: 'Spanish', nativeName: 'Español', dir: 'ltr', intl: 'es-419', reviewed: false, regions: 'Latin America' },
  { code: 'ar', name: 'Arabic', nativeName: 'العربية', dir: 'rtl', intl: 'ar-u-nu-latn', reviewed: false, regions: 'North Africa, Middle East' },
  { code: 'sw', name: 'Swahili', nativeName: 'Kiswahili', dir: 'ltr', intl: 'sw', reviewed: false, regions: 'Kenya, Tanzania, Uganda, eastern DRC' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', dir: 'ltr', intl: 'vi-VN', reviewed: false, regions: 'Vietnam' },
  { code: 'id', name: 'Indonesian', nativeName: 'Bahasa Indonesia', dir: 'ltr', intl: 'id-ID', reviewed: false, regions: 'Indonesia' },
  { code: 'hi', name: 'Hindi', nativeName: 'हिन्दी', dir: 'ltr', intl: 'hi-IN', reviewed: false, regions: 'India' },
  { code: 'bn', name: 'Bengali', nativeName: 'বাংলা', dir: 'ltr', intl: 'bn', reviewed: false, regions: 'Bangladesh, India' },
  { code: 'tl', name: 'Filipino', nativeName: 'Filipino', dir: 'ltr', intl: 'fil', reviewed: false, regions: 'Philippines' },
  { code: 'am', name: 'Amharic', nativeName: 'አማርኛ', dir: 'ltr', intl: 'am', reviewed: false, regions: 'Ethiopia' },
  { code: 'ha', name: 'Hausa', nativeName: 'Hausa', dir: 'ltr', intl: 'ha', reviewed: false, regions: 'Nigeria, Niger, Ghana' },
  { code: 'yo', name: 'Yoruba', nativeName: 'Yorùbá', dir: 'ltr', intl: 'yo', reviewed: false, regions: 'Nigeria, Benin' },
  { code: 'ln', name: 'Lingala', nativeName: 'Lingála', dir: 'ltr', intl: 'ln', reviewed: false, regions: 'DRC, Republic of the Congo' },
] as const satisfies readonly LocaleDefinition[];

export type Locale = (typeof LOCALE_REGISTRY)[number]['code'];

export const LOCALES: readonly Locale[] = LOCALE_REGISTRY.map((l) => l.code);
export const DEFAULT_LOCALE: Locale = 'en';

const BY_CODE = new Map<string, LocaleDefinition>(LOCALE_REGISTRY.map((l) => [l.code, l]));

/** Other tags people or browsers use for a registered language. */
const ALIASES: Record<string, Locale> = { fil: 'tl', in: 'id' };

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && BY_CODE.has(value);
}

export function getLocale(code: Locale): LocaleDefinition {
  return BY_CODE.get(code) ?? BY_CODE.get(DEFAULT_LOCALE)!;
}

/** Maps "pt-BR", "FR", "fil-PH"… to a registered code, or null. */
export function normalizeLocale(value: unknown): Locale | null {
  const raw = String(value ?? '').trim().toLowerCase().replace('_', '-');
  if (!raw) return null;
  if (isLocale(raw)) return raw;
  const base = raw.split('-')[0];
  if (isLocale(base)) return base;
  const alias = ALIASES[base];
  return alias && isLocale(alias) ? alias : null;
}

export function localeDir(code: Locale): 'ltr' | 'rtl' {
  return getLocale(code).dir;
}

/** BCP 47 tag for Intl/Date formatting. */
export function intlLocale(code: Locale): string {
  return getLocale(code).intl;
}

/** Label for pickers: "Kiswahili (Swahili)", or just the name when both match. */
export function localeLabel(code: Locale): string {
  const l = getLocale(code);
  return l.nativeName === l.name ? l.name : `${l.nativeName} (${l.name})`;
}
