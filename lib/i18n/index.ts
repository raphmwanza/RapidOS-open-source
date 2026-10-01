/**
 * Dashboard i18n. Languages come from the registry in ./locales.ts; strings
 * live in ./locales/<code>.json. English is bundled everywhere and is the
 * fallback for any key a locale does not (yet) translate. Other dictionaries
 * are loaded on demand with loadMessages().
 */
import en from './locales/en.json';

export {
  LOCALE_REGISTRY,
  LOCALES,
  DEFAULT_LOCALE,
  getLocale,
  intlLocale,
  isLocale,
  localeDir,
  localeLabel,
  normalizeLocale,
  type Locale,
  type LocaleDefinition,
} from './locales';
import { DEFAULT_LOCALE, normalizeLocale, type Locale } from './locales';

export type TranslationKey = keyof typeof en;
export type Messages = Partial<Record<TranslationKey, string>>;
export type TranslationVars = Record<string, string | number>;

/** Cookie that carries the dashboard UI language (read by the root layout). */
export const LOCALE_COOKIE = 'rapidos_locale';
export const LOCALE_STORAGE_KEY = 'rapidos.locale';

const english: Record<TranslationKey, string> = en;
const cache = new Map<Locale, Messages>([['en', english]]);

/** Loads (once) and returns a locale's dictionary. Unknown locales resolve to English. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const hit = cache.get(locale);
  if (hit) return hit;
  try {
    const mod = await import(`./locales/${locale}.json`);
    const messages = (mod.default ?? mod) as Messages;
    cache.set(locale, messages);
    return messages;
  } catch {
    return english;
  }
}

/** Makes an already-fetched dictionary available to translate() (used by the client provider). */
export function registerMessages(locale: Locale, messages: Messages) {
  if (locale !== 'en') cache.set(locale, messages);
}

export function hasMessages(locale: Locale): boolean {
  return cache.has(locale);
}

export function interpolate(template: string, vars?: TranslationVars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : match,
  );
}

/**
 * Synchronous lookup with English fallback. Call `await loadMessages(locale)`
 * first on the server; the client provider does it before switching locale.
 */
export function translate(locale: Locale, key: TranslationKey, vars?: TranslationVars): string {
  const template = cache.get(locale)?.[key] || english[key] || key;
  return interpolate(template, vars);
}

/** Picks a locale from an Accept-Language header, defaulting to English. */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale {
  for (const part of String(header || '').split(',')) {
    const locale = normalizeLocale(part.split(';')[0]);
    if (locale) return locale;
  }
  return DEFAULT_LOCALE;
}
