import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { callingCodeFor, normalizePhoneE164, phoneLookupVariants } from '@/lib/phone';
import { mergeCustomerProfile, type ProfileFields } from './profile';

type Db = Prisma.TransactionClient | typeof prisma;

/** The calling code used for national numbers of this company (null if unknown). */
export async function companyCallingCode(companyId: string, db: Db = prisma): Promise<string | null> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { country: true, contactPhone: true } });
  return callingCodeFor(company?.country, company?.contactPhone);
}

/** Normalises a phone for a company; null when it cannot be read as an international number. */
export async function normalizeCompanyPhone(companyId: string, raw: string | null | undefined, db: Db = prisma): Promise<string | null> {
  return normalizePhoneE164(raw, await companyCallingCode(companyId, db));
}

/** The company's customer for a number (any stored form), oldest first. */
export async function findCustomerByPhone(companyId: string, e164: string, db: Db = prisma) {
  return db.customer.findFirst({
    where: { companyId, phoneNumber: { in: phoneLookupVariants(e164) } },
    orderBy: { createdAt: 'asc' },
  });
}

/**
 * Finds or creates THE customer of a company for an E.164 number. Existing
 * profiles are only completed (empty fields) or explicitly corrected. A
 * concurrent create (unique (phone_number, company_id)) is retried as an update.
 */
export async function upsertCustomerByPhone(
  db: Db,
  input: { companyId: string; phoneNumber: string; profile?: ProfileFields; corrected?: Iterable<string> },
) {
  const { companyId, phoneNumber } = input;
  const profile = input.profile || {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await findCustomerByPhone(companyId, phoneNumber, db);
    if (existing) {
      const update = mergeCustomerProfile(existing, profile, input.corrected);
      if (existing.phoneNumber !== phoneNumber) (update as Record<string, unknown>).phoneNumber = phoneNumber;
      if (!Object.keys(update).length) return existing;
      return db.customer.update({ where: { id: existing.id }, data: update });
    }
    try {
      return await db.customer.create({
        data: {
          companyId,
          phoneNumber,
          firstName: profile.firstName || null,
          lastName: profile.lastName || null,
          email: profile.email || null,
          policyNumber: profile.policyNumber || null,
          address: profile.address || null,
        },
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') || attempt > 0) throw error;
    }
  }
  throw new Error('customer upsert failed');
}
