// Choices offered by the /contact form. The values are stored as-is in the
// contact_requests table; the labels are what visitors see.

export const COMPANY_TYPES = [
  { value: 'insurer', label: 'Insurer' },
  { value: 'broker', label: 'Broker' },
  { value: 'mutual', label: 'Mutual' },
  { value: 'other', label: 'Other' },
] as const;

export const EMPLOYEE_RANGES = ['1-10', '11-50', '51-200', '201-1000', '1000+'] as const;

export const INSURED_CUSTOMER_RANGES = ['Under 1,000', '1,000-10,000', '10,000-100,000', '100,000-1,000,000', 'Over 1,000,000'] as const;

export const CLAIMS_PER_MONTH_RANGES = ['Under 50', '50-200', '200-1,000', '1,000-5,000', 'Over 5,000'] as const;

export const COVERAGE_OPTIONS = ['Auto', 'Health', 'Home', 'Fire', 'Life', 'Travel', 'Business'] as const;

export const DEPLOYMENT_OPTIONS = [
  { value: 'hosted', label: 'Hosted by us (RapidOS team)' },
  { value: 'self_hosted_support', label: 'Self-hosted, with our support' },
  { value: 'not_sure', label: 'Not sure yet' },
] as const;

export const HEARD_FROM_OPTIONS = ['Search engine', 'GitHub', 'LinkedIn', 'Word of mouth', 'Event or conference', 'Other'] as const;

/** Name of the hidden anti-spam field (humans leave it empty). */
export const HONEYPOT_FIELD = 'website';

/** Forms sent faster than this after the page loaded are treated as bots. */
export const MIN_FILL_MS = 3000;
