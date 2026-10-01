// Validation of the /contact form, shared by the browser form and POST /api/contact.

import {
  CLAIMS_PER_MONTH_RANGES,
  COMPANY_TYPES,
  COVERAGE_OPTIONS,
  DEPLOYMENT_OPTIONS,
  EMPLOYEE_RANGES,
  HONEYPOT_FIELD,
  INSURED_CUSTOMER_RANGES,
  MIN_FILL_MS,
} from '@/config/contact';

export interface ContactInput {
  fullName: string;
  workEmail: string;
  phone: string;
  companyName: string;
  country: string;
  companyType: string;
  employees: string;
  insuredCustomers: string;
  claimsPerMonth: string;
  coverages: string[];
  deployment: string;
  /** YYYY-MM-DD, or '' when not given. */
  desiredStart: string;
  heardFrom: string;
  message: string;
}

export type ContactFieldError = 'required' | 'too_long' | 'invalid_email' | 'invalid_phone' | 'invalid_choice' | 'invalid_date' | 'too_short';

export const CONTACT_LIMITS = {
  fullName: 120,
  workEmail: 254,
  phone: 32,
  companyName: 160,
  country: 80,
  heardFrom: 120,
  message: 4000,
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
// Digits with optional +, spaces, dashes, dots and parentheses; 6 to 15 digits.
const PHONE_RE = /^\+?[0-9 ().-]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** Trims and normalises raw form or JSON values. Unknown keys are ignored. */
export function normalizeContact(raw: Record<string, unknown>): ContactInput {
  const coverages = Array.isArray(raw.coverages) ? raw.coverages.filter((c): c is string => typeof c === 'string').map((c) => c.trim()) : [];
  return {
    fullName: str(raw.fullName),
    workEmail: str(raw.workEmail).toLowerCase(),
    phone: str(raw.phone),
    companyName: str(raw.companyName),
    country: str(raw.country),
    companyType: str(raw.companyType),
    employees: str(raw.employees),
    insuredCustomers: str(raw.insuredCustomers),
    claimsPerMonth: str(raw.claimsPerMonth),
    coverages: Array.from(new Set(coverages)),
    deployment: str(raw.deployment),
    desiredStart: str(raw.desiredStart),
    heardFrom: str(raw.heardFrom),
    message: str(raw.message),
  };
}

function validDate(s: string): boolean {
  if (!DATE_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s) return false;
  const year = d.getUTCFullYear();
  return year >= 2000 && year <= 2100;
}

/** Returns field -> error; an empty object means the input is valid. */
export function validateContact(input: ContactInput): Partial<Record<keyof ContactInput, ContactFieldError>> {
  const errors: Partial<Record<keyof ContactInput, ContactFieldError>> = {};
  const requiredText: Array<keyof typeof CONTACT_LIMITS> = ['fullName', 'workEmail', 'phone', 'companyName', 'country', 'message'];
  for (const field of requiredText) {
    if (!input[field]) errors[field] = 'required';
  }
  for (const [field, max] of Object.entries(CONTACT_LIMITS) as Array<[keyof typeof CONTACT_LIMITS, number]>) {
    if (input[field].length > max) errors[field] = 'too_long';
  }
  if (input.workEmail && !errors.workEmail && !EMAIL_RE.test(input.workEmail)) errors.workEmail = 'invalid_email';
  if (input.phone && !errors.phone) {
    const digits = input.phone.replace(/\D/g, '').length;
    if (!PHONE_RE.test(input.phone) || digits < 6 || digits > 15) errors.phone = 'invalid_phone';
  }
  if (input.message && !errors.message && input.message.length < 10) errors.message = 'too_short';

  const choice = (field: keyof ContactInput, allowed: readonly string[]) => {
    const value = input[field] as string;
    if (!value) errors[field] = 'required';
    else if (!allowed.includes(value)) errors[field] = 'invalid_choice';
  };
  choice('companyType', COMPANY_TYPES.map((c) => c.value));
  choice('employees', EMPLOYEE_RANGES);
  choice('insuredCustomers', INSURED_CUSTOMER_RANGES);
  choice('claimsPerMonth', CLAIMS_PER_MONTH_RANGES);
  choice('deployment', DEPLOYMENT_OPTIONS.map((d) => d.value));

  if (input.coverages.length === 0) errors.coverages = 'required';
  else if (input.coverages.some((c) => !(COVERAGE_OPTIONS as readonly string[]).includes(c))) errors.coverages = 'invalid_choice';

  if (input.desiredStart && !validDate(input.desiredStart)) errors.desiredStart = 'invalid_date';
  return errors;
}

export const CONTACT_ERROR_TEXT: Record<ContactFieldError, string> = {
  required: 'This field is required.',
  too_long: 'This is too long.',
  too_short: 'Please write a few more words.',
  invalid_email: 'Enter a valid email address.',
  invalid_phone: 'Enter a valid phone number, with the country code (e.g. +243 81 000 0000).',
  invalid_choice: 'Choose one of the options.',
  invalid_date: 'Enter a valid date.',
};

/** True when the hidden field was filled or the form was sent too fast. */
export function looksLikeBot(body: Record<string, unknown>, now = Date.now()): boolean {
  const trap = body[HONEYPOT_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') return true;
  const startedAt = Number(body.startedAt);
  if (!Number.isFinite(startedAt) || startedAt <= 0) return true;
  return now - startedAt < MIN_FILL_MS;
}
