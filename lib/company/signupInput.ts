/**
 * Shared (client + server) validation for the company signup wizard.
 * Errors are returned as codes so the UI can translate them.
 */
import { normalizeLocale, type Locale } from '@/lib/i18n';
import { BEHAVIOR_TOGGLES, COVERAGE_TYPES, defaultBehaviorToggles, type BehaviorToggles, type CoverageType } from './catalog';

export type SignupErrorCode =
  | 'required'
  | 'too_long'
  | 'invalid_email'
  | 'invalid_phone'
  | 'invalid_slug'
  | 'invalid_domain'
  | 'invalid_url'
  | 'invalid_color'
  | 'invalid_language'
  | 'coverage_required'
  | 'taken';

export interface SignupInput {
  companyName: string;
  slug: string;
  domain: string;
  contactEmail: string;
  contactPhone: string;
  country: string;
  city: string;
  address: string;
  logoUrl: string;
  primaryColor: string;
  whatsappDisplayNumber: string;
  businessHours: string;
  claimsEmail: string;
  adminFirstName: string;
  adminLastName: string;
  adminEmail: string;
  coverage: CoverageType[];
  toggles: BehaviorToggles;
  language: Locale;
}

export type SignupField = keyof SignupInput;
export type SignupErrors = Partial<Record<SignupField, SignupErrorCode>>;

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_PATTERN = /^\+?[0-9][0-9 ().-]{5,24}$/;
const DOMAIN_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const COLOR_PATTERN = /^#[0-9a-fA-F]{6}$/;

/** Company name → URL-friendly identifier ("Acme Assurance SA" → "acme-assurance-sa"). */
export function slugify(value: string): string {
  return value
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50)
    .replace(/-+$/g, '');
}

/** Accepts "https://www.acme.com/" and returns "www.acme.com". */
export function normalizeDomain(value: string): string {
  return value.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '');
}

const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max + 1);

export function parseSignupInput(body: any): { input: SignupInput; errors: SignupErrors } {
  const errors: SignupErrors = {};
  const toggles = defaultBehaviorToggles();
  for (const toggle of BEHAVIOR_TOGGLES) {
    const raw = body?.toggles?.[toggle.key];
    if (typeof raw === 'boolean') toggles[toggle.key] = raw;
  }
  const coverage = Array.isArray(body?.coverage)
    ? Array.from(new Set(body.coverage.map((c: unknown) => String(c).toUpperCase()))).filter((c): c is CoverageType => (COVERAGE_TYPES as string[]).includes(c as string))
    : [];
  const companyName = str(body?.companyName, 120);
  const slug = str(body?.slug, 50).toLowerCase() || slugify(companyName);
  const language = normalizeLocale(body?.language);

  const input: SignupInput = {
    companyName,
    slug,
    domain: normalizeDomain(str(body?.domain, 253)),
    contactEmail: str(body?.contactEmail, 254).toLowerCase(),
    contactPhone: str(body?.contactPhone, 30),
    country: str(body?.country, 80),
    city: str(body?.city, 80),
    address: str(body?.address, 200),
    logoUrl: str(body?.logoUrl, 500),
    primaryColor: str(body?.primaryColor, 7),
    whatsappDisplayNumber: str(body?.whatsappDisplayNumber, 30),
    businessHours: str(body?.businessHours, 200),
    claimsEmail: str(body?.claimsEmail, 254).toLowerCase(),
    adminFirstName: str(body?.adminFirstName, 60),
    adminLastName: str(body?.adminLastName, 60),
    adminEmail: str(body?.adminEmail, 254).toLowerCase(),
    coverage,
    toggles,
    language: language ?? 'en',
  };

  const limits: Partial<Record<SignupField, number>> = {
    companyName: 120, slug: 50, domain: 253, contactEmail: 254, contactPhone: 30, country: 80, city: 80, address: 200,
    logoUrl: 500, whatsappDisplayNumber: 30, businessHours: 200, claimsEmail: 254, adminFirstName: 60, adminLastName: 60, adminEmail: 254,
  };
  for (const field of ['companyName', 'contactEmail', 'contactPhone', 'country', 'city', 'adminFirstName', 'adminLastName', 'adminEmail'] as const) {
    if (!input[field]) errors[field] = 'required';
  }
  for (const [field, max] of Object.entries(limits) as Array<[SignupField, number]>) {
    const value = input[field];
    if (!errors[field] && typeof value === 'string' && value.length > max) errors[field] = 'too_long';
  }
  if (!errors.companyName && input.companyName.length < 2) errors.companyName = 'required';
  if (!errors.slug && (input.slug.length < 3 || !SLUG_PATTERN.test(input.slug))) errors.slug = 'invalid_slug';
  if (!errors.domain && input.domain && !DOMAIN_PATTERN.test(input.domain)) errors.domain = 'invalid_domain';
  for (const field of ['contactEmail', 'adminEmail', 'claimsEmail'] as const) {
    if (!errors[field] && input[field] && !EMAIL_PATTERN.test(input[field])) errors[field] = 'invalid_email';
  }
  for (const field of ['contactPhone', 'whatsappDisplayNumber'] as const) {
    if (!errors[field] && input[field] && !PHONE_PATTERN.test(input[field])) errors[field] = 'invalid_phone';
  }
  if (!errors.logoUrl && input.logoUrl && !/^https?:\/\/[^\s]+$/i.test(input.logoUrl)) errors.logoUrl = 'invalid_url';
  if (input.primaryColor && !COLOR_PATTERN.test(input.primaryColor)) errors.primaryColor = 'invalid_color';
  if (!language) errors.language = 'invalid_language';
  if (input.coverage.length === 0) errors.coverage = 'coverage_required';

  return { input, errors };
}
