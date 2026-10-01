import { NextRequest, NextResponse } from 'next/server';
import { ClaimCategory, Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/prisma';
import { authMiddleware, authOrInternalKeyMiddleware, getAdminFromRequest, isValidInternalApiKey } from '@/lib/middleware';
import { attachPendingMedia } from '@/lib/storage/documents';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';
import { companyCallingCode, upsertCustomerByPhone } from '@/lib/customers/upsert';
import { splitFullName, type ProfileFields } from '@/lib/customers/profile';
import { normalizePhoneE164, phoneLookupVariants } from '@/lib/phone';

// Empty strings and nulls (common in bot / form payloads) mean "not provided".
const blank = (v: unknown) => (v === '' || v === null ? undefined : typeof v === 'string' && v.trim() === '' ? undefined : v);
const optText = (max: number) => z.preprocess(blank, z.string().trim().max(max).optional());
const optBool = z.preprocess((v) => {
  const b = blank(v);
  if (typeof b === 'string') return ['true', 'yes', '1'].includes(b.toLowerCase()) ? true : ['false', 'no', '0'].includes(b.toLowerCase()) ? false : undefined;
  return b;
}, z.boolean().optional());
const optEmail = z.preprocess((v) => {
  const b = blank(v);
  return typeof b === 'string' && z.string().email().safeParse(b.trim()).success ? b.trim() : undefined;
}, z.string().optional());
const optDate = z.preprocess((v) => {
  const b = blank(v);
  return typeof b === 'string' && /^\d{4}-\d{2}-\d{2}/.test(b.trim()) ? b.trim().slice(0, 10) : undefined;
}, z.string().optional());

const createClaim = z.object({
  insuredFullName: z.string().trim().min(1).max(200),
  phoneNumber: z.string().trim().min(3).max(40),
  claimCategory: optText(40),
  claimTypeName: optText(50),
  claimFields: z.preprocess(blank, z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional()),
  source: optText(40),
  policyNumber: optText(100),
  address: optText(500),
  email: optEmail,
  incidentDate: optDate,
  /** The customer only knew the date roughly; incidentDateText keeps their wording. */
  incidentDateApproximate: optBool,
  incidentDateText: optText(300),
  /** Profile fields the customer explicitly corrected (they may overwrite the stored profile). */
  correctedFields: z.preprocess(blank, z.array(z.string().max(60)).max(30).optional().catch(undefined)),
  incidentLocation: optText(500),
  incidentTime: optText(30),
  incidentDescription: optText(10000),
  description: optText(20000),
  damageDescription: optText(10000),
  vehicleMakeModel: optText(200),
  vehicleYear: z.preprocess(blank, z.coerce.number().int().min(1900).max(new Date().getFullYear() + 1).optional()),
  vehicleRegistration: optText(100),
  vehicleVin: optText(100),
  licenseNumber: optText(100),
  policeReportNumber: optText(100),
  injuryDescription: optText(5000),
  injuriesOccurred: optBool,
  policeContacted: optBool,
  medicalTreatmentRequired: optBool,
  additionalNotes: optText(10000),
  /** Language the customer used (ISO 639-1, e.g. "fr"); claim PDFs are written in it. */
  language: z.preprocess(blank, z.string().trim().toLowerCase().regex(/^[a-z]{2,3}(-[a-z0-9]{2,4})?$/).optional().catch(undefined)),
});

function category(value?: string): ClaimCategory {
  const normalized = (value || 'AUTO').trim().toUpperCase();
  return (Object.values(ClaimCategory) as string[]).includes(normalized) ? normalized as ClaimCategory : ClaimCategory.OTHER;
}
function numberForCompany(slug: string) { return `${slug.slice(0, 4).toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`; }
/** A calendar date (YYYY-MM-DD) stored at UTC midnight so it never shifts a day across time zones. */
function utcDate(day?: string) { return day ? new Date(`${day}T00:00:00.000Z`) : null; }
function isPlaceholderName(name: string, phone: string) { return /^whatsapp\s/i.test(name) || name.replace(/\D/g, '') === phone.replace(/\D/g, ''); }

export async function POST(request: NextRequest) {
  const authError = await authOrInternalKeyMiddleware(request);
  if (authError) return authError;
  try {
    const input = createClaim.parse(await request.json());
    const admin = getAdminFromRequest(request);
    const internal = isValidInternalApiKey(request);
    // The company header is only honoured together with the internal service key.
    const companyId = admin?.companyId || (internal ? request.headers.get('x-company-id') : null);
    if (!companyId) return NextResponse.json({ error: 'Company context is required' }, { status: 403 });
    const company = await prisma.company.findFirst({ where: { id: companyId, isActive: true }, select: { id: true, slug: true } });
    if (!company) return NextResponse.json({ error: 'Company not found' }, { status: 404 });
    // WhatsApp claims always belong to the sender of the conversation (a wa_id is
    // already international). Every number is stored in E.164 so "+243 81…",
    // "0812…" and "243812…" are one customer.
    const callingCode = await companyCallingCode(companyId);
    const whatsappHeader = internal ? (request.headers.get('x-whatsapp-phone') || '').trim() : '';
    const phoneNumber = whatsappHeader
      ? normalizePhoneE164(whatsappHeader.startsWith('+') ? whatsappHeader : `+${whatsappHeader.replace(/\D/g, '')}`, callingCode)
      : normalizePhoneE164(input.phoneNumber, callingCode);
    if (!phoneNumber) return NextResponse.json({ error: 'Invalid phone number: use the international format, e.g. +243812345678' }, { status: 400 });
    const placeholderName = isPlaceholderName(input.insuredFullName, phoneNumber);
    // A returning customer's profile is only completed (empty fields) or
    // explicitly corrected; a new claim never silently overwrites it.
    const profile: ProfileFields = {
      ...(placeholderName ? {} : splitFullName(input.insuredFullName)),
      email: input.email || null,
      policyNumber: input.policyNumber || null,
      address: input.address || null,
    };
    const descriptionParts = [input.description, input.incidentDescription, input.damageDescription]
      .filter((v): v is string => !!v)
      .filter((v, i, all) => all.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i);
    const description = input.description || descriptionParts.join('\n\n') || null;
    const claimType = input.claimTypeName
      ? await prisma.claimType.findFirst({
          where: { companyId, typeName: { equals: input.claimTypeName, mode: 'insensitive' } },
          include: { fields: { where: { isActive: true }, select: { fieldName: true, isRequired: true, fieldType: true } } },
        })
      : null;
    const fieldData = input.claimFields || {};
    let completion = 0;
    if (claimType) {
      const required = claimType.fields.filter((f: { fieldName: string; isRequired: boolean; fieldType: string }) => f.isRequired && !['array', 'document', 'file'].includes(f.fieldType));
      const filled = required.filter((f: { fieldName: string }) => fieldData[f.fieldName] !== undefined && `${fieldData[f.fieldName]}`.trim() !== '');
      completion = required.length ? Math.round((filled.length / required.length) * 10000) / 100 : 100;
    }
    const bool = (v?: boolean) => (v === undefined ? undefined : v ? 'true' : 'false');
    const claim = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const customer = await upsertCustomerByPhone(tx, { companyId, phoneNumber, profile, corrected: input.correctedFields });
      const created = await tx.claim.create({
        data: {
          companyId,
          customerId: customer.id,
          claimNumber: numberForCompany(company.slug),
          type: category(input.claimCategory),
          description,
          incidentDate: utcDate(input.incidentDate),
          incidentDateApproximate: input.incidentDateApproximate === true,
          incidentDateText: input.incidentDateApproximate ? input.incidentDateText || null : null,
          incidentTime: input.incidentTime || null,
          language: input.language || null,
          notes: input.additionalNotes || null,
          botNotes: input.source === 'whatsapp' ? 'Created by the WhatsApp assistant after the customer confirmed the summary.' : null,
          autoClaimData: {
            create: {
              insuredFullName: input.insuredFullName,
              phoneNumber,
              policyNumber: input.policyNumber || null,
              address: input.address || null,
              email: input.email || null,
              incidentLocation: input.incidentLocation || null,
              damageDescription: input.damageDescription || null,
              vehicleMakeModel: input.vehicleMakeModel || null,
              vehicleYear: input.vehicleYear || null,
              vehicleRegistration: input.vehicleRegistration || null,
              vehicleVin: input.vehicleVin || null,
              licenseNumber: input.licenseNumber || null,
              policeReportNumber: input.policeReportNumber || null,
              injuryDescription: input.injuryDescription || null,
              additionalNotes: input.additionalNotes || null,
              ...(bool(input.injuriesOccurred) ? { injuriesOccurred: bool(input.injuriesOccurred) } : {}),
              ...(bool(input.policeContacted) ? { policeContacted: bool(input.policeContacted) } : {}),
              ...(bool(input.medicalTreatmentRequired) ? { medicalTreatmentRequired: bool(input.medicalTreatmentRequired) } : {}),
            },
          },
          ...(claimType
            ? { dynamicClaimData: { create: { claimTypeId: claimType.id, fieldData: fieldData as Prisma.InputJsonValue, completionPercentage: completion, requiresReview: completion < 100 } } }
            : {}),
        },
        include: { customer: true, autoClaimData: true, dynamicClaimData: true },
      });
      return created;
    });
    // Photos/documents the customer sent on WhatsApp before the claim existed,
    // then the claim report PDF. Neither may fail the claim creation.
    try {
      const attached = await attachPendingMedia(companyId, claim.customerId, claim.id);
      if (attached) console.info(`[claims] attached ${attached} pending file(s) to ${claim.claimNumber}`);
    } catch (error) {
      console.error(`[claims] attaching pending media to ${claim.claimNumber} failed`, error);
    }
    const pdf = await generateAndStoreClaimPdf({ claimId: claim.id, companyId, kind: 'report', reason: 'claim_created' });
    return NextResponse.json({ success: true, claim: { ...claim, pdfPath: pdf ? `/api/claims/${claim.claimNumber}/pdf` : claim.pdfPath }, pdf }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: 'Invalid claim data', details: error.flatten() }, { status: 400 });
    if (error instanceof SyntaxError) return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return NextResponse.json({ error: 'Unable to allocate a claim number; please retry' }, { status: 409 });
    console.error('[claims] create failed', error);
    return NextResponse.json({ error: 'Unable to create claim' }, { status: 500 });
  }
}

export async function GET(request: NextRequest) {
  const authError = await authMiddleware(request); if (authError) return authError;
  const admin = getAdminFromRequest(request); if (!admin) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  const customerId = request.nextUrl.searchParams.get('customerId') || undefined;
  const rawPhone = request.nextUrl.searchParams.get('phoneNumber');
  const phone = rawPhone ? normalizePhoneE164(rawPhone, await companyCallingCode(admin.companyId)) : null;
  if (rawPhone && !phone) return NextResponse.json({ claims: [] });
  const claims = await prisma.claim.findMany({ where: { companyId: admin.companyId, ...(customerId ? { customerId } : {}), ...(phone ? { customer: { phoneNumber: { in: phoneLookupVariants(phone) } } } : {}) }, include: { customer: true, autoClaimData: true, documents: { select: { id: true, claimId: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true } } }, orderBy: { createdAt: 'desc' } });
  return NextResponse.json({ claims });
}
