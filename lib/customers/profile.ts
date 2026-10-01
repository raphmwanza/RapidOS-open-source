/**
 * One customer per person per company: the customer is found (or created)
 * by (companyId, E.164 phone) and their profile is only completed, never
 * silently overwritten.
 */

export type ProfileFields = {
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  policyNumber?: string | null;
  address?: string | null;
};

/** Profile fields a caller may correct explicitly (claims API `correctedFields`). */
export type CorrectableField = 'insuredFullName' | 'policyNumber' | 'email' | 'address';

const empty = (v: unknown) => v === null || v === undefined || String(v).trim() === '';

/**
 * The update to apply to an existing customer: a field is written when it is
 * empty on the customer, or when the customer explicitly corrected it.
 * Placeholders ("WhatsApp 243…") never replace anything.
 */
export function mergeCustomerProfile(existing: ProfileFields, incoming: ProfileFields, corrected: Iterable<string> = []): ProfileFields {
  const fix = new Set(corrected);
  const out: ProfileFields = {};
  const take = (key: keyof ProfileFields, correctable: CorrectableField) => {
    const v = incoming[key];
    if (empty(v)) return;
    const value = String(v).trim();
    if (empty(existing[key]) || (fix.has(correctable) && String(existing[key]).trim() !== value)) out[key] = value;
  };
  // The name is one unit: a corrected or missing first name brings its last name.
  if (!empty(incoming.firstName)) {
    const nameFix = fix.has('insuredFullName');
    if (empty(existing.firstName) || nameFix) {
      if (String(existing.firstName ?? '').trim() !== String(incoming.firstName).trim()) out.firstName = String(incoming.firstName).trim();
      if (!empty(incoming.lastName) && (empty(existing.lastName) || nameFix)) out.lastName = String(incoming.lastName).trim();
    } else if (empty(existing.lastName) && !empty(incoming.lastName) && fold(existing.firstName) === fold(incoming.firstName)) {
      out.lastName = String(incoming.lastName).trim();
    }
  }
  take('email', 'email');
  take('policyNumber', 'policyNumber');
  take('address', 'address');
  if (out.lastName !== undefined && out.lastName === String(existing.lastName ?? '').trim()) delete out.lastName;
  return out;
}

function fold(v: unknown) {
  return String(v ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
}

/** Splits "Patrick Mbuyi" into first and last name. */
export function splitFullName(name: string): { firstName: string; lastName: string | null } {
  const [firstName, ...rest] = name.trim().split(/\s+/);
  return { firstName, lastName: rest.join(' ') || null };
}

export type MergeCandidate = { id: string; createdAt: Date | string | null; phoneNumber: string } & ProfileFields & {
  birthDate?: Date | string | null;
  licenseNumber?: string | null;
  isActive?: boolean | null;
};

/**
 * Plans the merge of duplicate customers of one company (the same person):
 * the oldest record is kept and gets every non-empty field it is missing,
 * taken from the duplicates in creation order. Mirrors the SQL migration
 * 20261001180000_client_dedupe_e164.
 */
export function planCustomerMerge(group: MergeCandidate[]): { keep: MergeCandidate; merged: MergeCandidate[]; fill: Record<string, unknown> } {
  const sorted = [...group].sort((a, b) => {
    const ta = a.createdAt ? new Date(a.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    const tb = b.createdAt ? new Date(b.createdAt).getTime() : Number.MAX_SAFE_INTEGER;
    return ta - tb || a.id.localeCompare(b.id);
  });
  const [keep, ...merged] = sorted;
  const fill: Record<string, unknown> = {};
  if (empty(keep.firstName)) {
    const named = merged.find((m) => !empty(m.firstName));
    if (named) {
      fill.firstName = named.firstName;
      if (empty(keep.lastName) && !empty(named.lastName)) fill.lastName = named.lastName;
    }
  } else if (empty(keep.lastName)) {
    const sameFirst = merged.find((m) => !empty(m.lastName) && fold(m.firstName) === fold(keep.firstName));
    if (sameFirst) fill.lastName = sameFirst.lastName;
  }
  for (const key of ['email', 'policyNumber', 'address', 'birthDate', 'licenseNumber'] as const) {
    if (empty(keep[key])) {
      const donor = merged.find((m) => !empty(m[key]));
      if (donor) fill[key] = donor[key];
    }
  }
  if (keep.isActive === false && merged.some((m) => m.isActive)) fill.isActive = true;
  return { keep, merged, fill };
}
