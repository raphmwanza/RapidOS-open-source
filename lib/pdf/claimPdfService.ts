/**
 * Generates, stores and serves claim PDFs (report and status summary).
 *
 * - Always scoped to one company (callers pass the company of the admin or of
 *   the internal service call).
 * - Language: the claim's language (set by the WhatsApp bot), else the
 *   company's bot language, else English. Locales whose script the embedded
 *   font cannot render fall back to English.
 * - The file is written to the file store (Docker volume) and linked on the
 *   claim as a ClaimDocument (one per kind, replaced on regeneration) and in
 *   claims.pdfPath.
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { DEFAULT_LOCALE, intlLocale, loadMessages, normalizeLocale, translate, type Locale, type TranslationKey, type TranslationVars } from '@/lib/i18n';
import { claimFolder, deleteStoredFile, readStoredFile, writeStoredFile, STORAGE_PREFIX } from '@/lib/storage/fileStore';
import { storageKeyOf } from '@/lib/storage/documents';
import { loadCompanyLogo, loadPdfFont } from './assets';
import { renderClaimPdf, type ClaimPdfData, type ClaimPdfKind } from './claimPdf';

export type { ClaimPdfKind } from './claimPdf';

/** Scripts DejaVu Sans cannot shape or does not contain (Ethiopic, Devanagari, Bengali). */
const NEEDS_OTHER_FONT = new Set<string>(['am', 'hi', 'bn']);
/** Locales whose text fits Helvetica's Latin-1 when no Unicode font is installed. */
const LATIN1_SAFE = new Set<string>(['en', 'fr', 'es', 'pt', 'sw', 'id', 'tl', 'ln']);

export function systemUploader(kind: ClaimPdfKind): string {
  return `system:pdf-${kind}`;
}

/** The language a PDF is written in, given the wanted one and the available font. */
export function pdfLocaleFor(wanted: string | null | undefined, hasUnicodeFont: boolean): Locale {
  const locale = normalizeLocale(wanted) || DEFAULT_LOCALE;
  if (NEEDS_OTHER_FONT.has(locale)) return DEFAULT_LOCALE;
  if (!hasUnicodeFont && !LATIN1_SAFE.has(locale)) return DEFAULT_LOCALE;
  return locale;
}

const claimInclude = {
  company: true,
  customer: true,
  autoClaimData: true,
  dynamicClaimData: { include: { claimType: { include: { fields: { where: { isActive: true }, orderBy: { sortOrder: 'asc' as const } } } } } },
  documents: { select: { fileName: true, fileSize: true, uploadedBy: true, fileType: true, filePath: true }, orderBy: { createdAt: 'asc' as const } },
  statusHistory: { orderBy: { changedAt: 'asc' as const } },
};

type LoadedClaim = NonNullable<Awaited<ReturnType<typeof loadClaim>>>;

async function loadClaim(claimId: string, companyId: string) {
  return prisma.claim.findFirst({ where: { id: claimId, companyId }, include: claimInclude });
}

function boolText(t: (k: TranslationKey) => string, v: unknown): string {
  return String(v).toLowerCase() === 'true' ? t('claimPdf.value.yes') : t('claimPdf.value.no');
}

function claimDetails(claim: LoadedClaim, t: (k: TranslationKey, v?: TranslationVars) => string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const seen = new Set<string>();
  const fieldData = (claim.dynamicClaimData?.fieldData || {}) as Record<string, unknown>;
  const add = (key: string, label: string, value: unknown) => {
    const text = value === null || value === undefined ? '' : String(value).trim();
    if (!text) return;
    seen.add(key.toLowerCase());
    out.push([label, text]);
  };
  const a = claim.autoClaimData;
  if (a) {
    add('policyNumber', t('claimPdf.field.policyNumber'), a.policyNumber);
    add('insuredFullName', t('claimPdf.field.insuredName'), a.insuredFullName);
    add('vehicleMakeModel', t('claimPdf.field.vehicle'), a.vehicleMakeModel);
    add('vehicleYear', t('claimPdf.field.vehicleYear'), a.vehicleYear);
    add('vehicleRegistration', t('claimPdf.field.registration'), a.vehicleRegistration);
    add('vehicleVin', t('claimPdf.field.vin'), a.vehicleVin);
    add('incidentLocation', t('claimPdf.field.location'), a.incidentLocation);
    add('damageDescription', t('claimPdf.field.damage'), a.damageDescription);
    // Booleans default to "false" in the table: only show the ones that were answered.
    for (const [key, label] of [['injuriesOccurred', 'claimPdf.field.injuries'], ['policeContacted', 'claimPdf.field.policeContacted'], ['medicalTreatmentRequired', 'claimPdf.field.medicalTreatment']] as const) {
      const v = (a as Record<string, unknown>)[key];
      if (key in fieldData || String(v) === 'true') add(key, t(label), boolText(t, key in fieldData ? fieldData[key] : v));
    }
    add('injuryDescription', t('claimPdf.field.injuryDescription'), a.injuryDescription);
    add('policeReportNumber', t('claimPdf.field.policeReport'), a.policeReportNumber);
    add('otherDriverName', t('claimPdf.field.otherDriver'), a.otherDriverName);
    add('witnessName', t('claimPdf.field.witness'), a.witnessName);
    add('additionalNotes', t('claimPdf.field.notes'), a.additionalNotes);
  }
  // Company-defined fields that are not already listed (sensitive ones are left out).
  const fields = claim.dynamicClaimData?.claimType?.fields || [];
  for (const f of fields) {
    if (f.isSensitive || seen.has(f.fieldName.toLowerCase()) || ['phonenumber', 'incidentdate', 'incidentdescription', 'incidenttime'].includes(f.fieldName.toLowerCase())) continue;
    const v = fieldData[f.fieldName];
    if (v === undefined || v === null || String(v).trim() === '') continue;
    add(f.fieldName, f.displayName || f.fieldName, typeof v === 'boolean' ? boolText(t, v) : v);
  }
  return out;
}

/** PDFs this service (or the old generator, via virtual API paths) produced: not listed as attachments. */
function isGeneratedPdf(d: { uploadedBy: string | null; filePath: string }): boolean {
  return String(d.uploadedBy || '').startsWith('system') || /^\/api\/(claims|clients)\/.*\/(pdf|status-pdf|status-update-pdf)$/.test(d.filePath);
}

export interface BuiltClaimPdf { buffer: Buffer; fileName: string; locale: Locale; claimNumber: string; claimId: string }

/** Renders a claim PDF (not stored). Returns null when the claim is not in this company. */
export async function buildClaimPdf(claimId: string, companyId: string, kind: ClaimPdfKind, wantedLocale?: string | null): Promise<BuiltClaimPdf | null> {
  const claim = await loadClaim(claimId, companyId);
  if (!claim) return null;
  const font = loadPdfFont();
  let locale = pdfLocaleFor(wantedLocale || claim.language || claim.company.botLanguage, !!font);
  // A language without PDF translations gets a fully English PDF rather than a mix.
  if (locale !== DEFAULT_LOCALE && !(await loadMessages(locale))['claimPdf.title.report']) locale = DEFAULT_LOCALE;
  await loadMessages(locale);
  const t = (key: TranslationKey, vars?: TranslationVars) => translate(locale, key, vars);
  const data: ClaimPdfData = {
    claimNumber: claim.claimNumber,
    type: claim.dynamicClaimData?.claimType?.typeName || claim.type,
    status: claim.status,
    description: claim.description,
    incidentDate: claim.incidentDate,
    incidentTime: claim.incidentTime,
    createdAt: claim.createdAt,
    estimatedAmount: claim.estimatedAmount,
    approvedAmount: claim.approvedAmount,
    company: { name: claim.company.name, contactEmail: claim.company.contactEmail, contactPhone: claim.company.contactPhone, primaryColor: claim.company.primaryColor },
    customer: { firstName: claim.customer.firstName, lastName: claim.customer.lastName, phoneNumber: claim.customer.phoneNumber, email: claim.customer.email },
    details: claimDetails(claim, t),
    documents: claim.documents.filter((d: { uploadedBy: string | null; filePath: string }) => !isGeneratedPdf(d)).map((d: { fileName: string; fileSize: number }) => ({ fileName: d.fileName, fileSize: d.fileSize })),
    statusHistory: claim.statusHistory.map((h: { fromStatus: string | null; toStatus: string; changedAt: Date; reason: string | null }) => ({ fromStatus: h.fromStatus, toStatus: h.toStatus, changedAt: h.changedAt, reason: h.reason })),
  };
  const logo = await loadCompanyLogo(claim.company.logoUrl);
  const buffer = renderClaimPdf(data, { kind, locale, intlLocale: intlLocale(locale), t, font, logo });
  const fileName = t(kind === 'status' ? 'claimPdf.fileName.status' : 'claimPdf.fileName.report', { claimNumber: claim.claimNumber });
  return { buffer, fileName, locale, claimNumber: claim.claimNumber, claimId: claim.id };
}

export interface StoredClaimPdf { documentId: string; fileName: string; size: number; locale: Locale; url: string }

/**
 * Renders the PDF, writes it to the file store and links it on the claim
 * (replacing the previous one of the same kind). Never throws: claim creation
 * and status changes must not fail because of the PDF.
 */
// One generation at a time per claim and kind (in this process), so two
// triggers (e.g. two uploads) cannot leave two "current" PDFs behind.
const generationQueue = new Map<string, Promise<unknown>>();

export async function generateAndStoreClaimPdf(opts: { claimId: string; companyId: string; kind?: ClaimPdfKind; reason: string }): Promise<StoredClaimPdf | null> {
  const key = `${opts.claimId}:${opts.kind || 'report'}`;
  const previousRun = generationQueue.get(key) || Promise.resolve();
  const run = previousRun.catch(() => undefined).then(() => generateNow(opts));
  generationQueue.set(key, run);
  try {
    return await run;
  } finally {
    if (generationQueue.get(key) === run) generationQueue.delete(key);
  }
}

async function generateNow(opts: { claimId: string; companyId: string; kind?: ClaimPdfKind; reason: string }): Promise<StoredClaimPdf | null> {
  const kind = opts.kind || 'report';
  try {
    const built = await buildClaimPdf(opts.claimId, opts.companyId, kind);
    if (!built) {
      console.warn(`[PDF] claim ${opts.claimId} not found in company ${opts.companyId}`);
      return null;
    }
    const key = await writeStoredFile(claimFolder(opts.companyId, opts.claimId), built.fileName, built.buffer);
    const claimNumberOf = built.claimNumber;
    // Previous system PDFs of this kind (and legacy metadata-only rows that never had bytes).
    const previous = await prisma.claimDocument.findMany({
      where: {
        claimId: opts.claimId,
        OR: [
          { uploadedBy: systemUploader(kind) },
          // Rows left by the old generator: virtual API paths, often with no bytes at all.
          ...(kind === 'report'
            ? [
                { fileType: 'application/pdf', filePath: `/api/claims/${claimNumberOf}/pdf` },
                { fileType: 'application/pdf', filePath: { startsWith: '/api/clients/', endsWith: `/claims/${claimNumberOf}/pdf` } },
              ]
            : [{ fileType: 'application/pdf', filePath: { startsWith: `/api/claims/${claimNumberOf}/status-` } }]),
        ],
      },
      select: { id: true, filePath: true },
    });
    const doc = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (previous.length) await tx.claimDocument.deleteMany({ where: { id: { in: previous.map((p: { id: string }) => p.id) } } });
      const created = await tx.claimDocument.create({
        data: { claimId: opts.claimId, fileName: built.fileName, filePath: `${STORAGE_PREFIX}${key}`, fileType: 'application/pdf', fileSize: built.buffer.length, uploadedBy: systemUploader(kind) },
        select: { id: true },
      });
      if (kind === 'report') await tx.claim.update({ where: { id: opts.claimId }, data: { pdfPath: `/api/claims/${built.claimNumber}/pdf` } });
      return created;
    });
    for (const p of previous) {
      const old = storageKeyOf(p.filePath);
      if (old) await deleteStoredFile(old, opts.companyId);
    }
    console.info(`[PDF] ${kind} for ${built.claimNumber} (${built.locale}, ${built.buffer.length} bytes, reason=${opts.reason}) stored as document ${doc.id}`);
    return { documentId: doc.id, fileName: built.fileName, size: built.buffer.length, locale: built.locale, url: `/api/documents/${opts.claimId}/${doc.id}` };
  } catch (error) {
    console.error(`[PDF] Failed to generate ${kind} PDF for claim ${opts.claimId}:`, error);
    return null;
  }
}

/** The stored PDF of this kind, if any (bytes read from the company's storage). */
export async function readStoredClaimPdf(claimId: string, companyId: string, kind: ClaimPdfKind): Promise<{ buffer: Buffer; fileName: string } | null> {
  const doc = await prisma.claimDocument.findFirst({
    where: { claimId, uploadedBy: systemUploader(kind), claim: { companyId } },
    orderBy: { createdAt: 'desc' },
    select: { fileName: true, filePath: true },
  });
  const key = doc ? storageKeyOf(doc.filePath) : null;
  if (!doc || !key) return null;
  const buffer = await readStoredFile(key, companyId);
  return buffer ? { buffer, fileName: doc.fileName } : null;
}

/** Stored PDF, generated (and stored) first when missing. */
export async function getOrCreateClaimPdf(claimId: string, companyId: string, kind: ClaimPdfKind): Promise<{ buffer: Buffer; fileName: string } | null> {
  const stored = await readStoredClaimPdf(claimId, companyId, kind);
  if (stored) return stored;
  const created = await generateAndStoreClaimPdf({ claimId, companyId, kind, reason: 'requested' });
  return created ? readStoredClaimPdf(claimId, companyId, kind) : null;
}

/** Content-Disposition with an ASCII fallback and the UTF-8 name. */
export function contentDisposition(kind: 'inline' | 'attachment', fileName: string): string {
  const ascii = fileName.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '_') || 'document.pdf';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

