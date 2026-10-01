import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest, isValidInternalApiKey } from '@/lib/middleware';
import { documentUrl, storeClaimDocument, storePendingMedia, validateUpload } from '@/lib/storage/documents';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const digits = (v: string | null | undefined) => String(v || '').replace(/\D/g, '');

type Caller =
  | { kind: 'admin'; companyId: string; uploadedBy: string }
  | { kind: 'service'; companyId: string; uploadedBy: string };

/**
 * Who is uploading:
 * - an admin of the dashboard (JWT), for a claim of their company;
 * - the WhatsApp bot (Go backend): internal API key + X-Company-ID. The
 *   company header is only honoured together with a valid internal key.
 */
async function resolveCaller(request: NextRequest): Promise<Caller | NextResponse> {
  if (isValidInternalApiKey(request)) {
    const companyId = request.headers.get('x-company-id') || '';
    if (!UUID.test(companyId)) return NextResponse.json({ error: 'X-Company-ID is required' }, { status: 400 });
    const company = await prisma.company.findFirst({ where: { id: companyId, isActive: true }, select: { id: true } });
    if (!company) return NextResponse.json({ error: 'Company not found or inactive' }, { status: 403 });
    return { kind: 'service', companyId, uploadedBy: 'whatsapp' };
  }
  const authError = await authMiddleware(request);
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  return { kind: 'admin', companyId: admin.companyId, uploadedBy: admin.id };
}

/**
 * POST /api/media/upload (multipart)
 *   file          the photo or document (max 10 MB; images, PDF, Word; type checked from the bytes)
 *   claimNumber   claim to attach to (dashboard: required). The bot may send
 *                 "temp_<customerId>" (legacy) or customerId instead.
 *   customerId    (bot) the customer who sent the file; must belong to the company
 *   pending=true  (bot) a claim is being filed: keep the file until it is created
 *
 * The file is written to the company's storage (Docker volume) and linked on
 * the claim as a ClaimDocument; the claim report PDF is regenerated so it
 * lists the new document. Bot media without an open claim is kept as pending
 * and attached when the customer's next claim is created.
 */
export async function POST(request: NextRequest) {
  const caller = await resolveCaller(request);
  if (caller instanceof NextResponse) return caller;

  try {
    const form = await request.formData();
    const file = form.get('file');
    if (!file || typeof file === 'string') return NextResponse.json({ success: false, error: 'No file provided' }, { status: 400 });
    let claimNumber = String(form.get('claimNumber') || '').trim();
    let customerId = String(form.get('customerId') || '').trim();
    if (claimNumber.startsWith('temp_')) {
      customerId = customerId || claimNumber.slice(5);
      claimNumber = '';
    }
    const pendingRequested = String(form.get('pending') || '') === 'true';

    const upload = validateUpload(Buffer.from(await file.arrayBuffer()), file.type, file.name, caller.kind === 'service' ? 'whatsapp-media' : 'document');
    if (!upload.ok) return NextResponse.json({ success: false, error: upload.error }, { status: upload.status });

    let claim: { id: string; claimNumber: string; companyId: string } | null = null;
    if (caller.kind === 'admin') {
      if (!claimNumber) return NextResponse.json({ success: false, error: 'claimNumber is required' }, { status: 400 });
      // Another company's claim number answers 404, like an unknown one.
      claim = await prisma.claim.findFirst({ where: { claimNumber, companyId: caller.companyId }, select: { id: true, claimNumber: true, companyId: true } });
      if (!claim) return NextResponse.json({ success: false, error: 'Claim not found' }, { status: 404 });
    } else {
      if (!UUID.test(customerId)) return NextResponse.json({ success: false, error: 'customerId is required' }, { status: 400 });
      const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId: caller.companyId }, select: { id: true, phoneNumber: true } });
      if (!customer) return NextResponse.json({ success: false, error: 'Customer not found in this company' }, { status: 403 });
      const phone = digits(request.headers.get('x-whatsapp-phone'));
      if (phone && digits(customer.phoneNumber) !== phone) return NextResponse.json({ success: false, error: 'Customer does not match the WhatsApp number' }, { status: 403 });
      if (claimNumber) {
        claim = await prisma.claim.findFirst({ where: { claimNumber, companyId: caller.companyId, customerId }, select: { id: true, claimNumber: true, companyId: true } });
      } else if (!pendingRequested) {
        claim = await prisma.claim.findFirst({
          where: { customerId, companyId: caller.companyId, status: { in: ['NEW', 'ONGOING'] } },
          orderBy: { createdAt: 'desc' },
          select: { id: true, claimNumber: true, companyId: true },
        });
      }
      if (!claim) {
        await storePendingMedia({ companyId: caller.companyId, customerId, fileName: upload.fileName, mimeType: upload.mimeType, data: upload.data, uploadedBy: caller.uploadedBy });
        console.info(`[MEDIA UPLOAD] ${upload.fileName} (${upload.data.length} bytes) kept for customer ${customerId} until their claim is created`);
        return NextResponse.json({ success: true, pending: true, url: null, documentId: null, claimNumber: null, fileName: upload.fileName, size: upload.data.length, mimeType: upload.mimeType });
      }
    }

    const doc = await storeClaimDocument({ companyId: caller.companyId, claimId: claim.id, fileName: upload.fileName, mimeType: upload.mimeType, data: upload.data, uploadedBy: caller.uploadedBy });
    console.info(`[MEDIA UPLOAD] ${doc.fileName} (${doc.fileSize} bytes, ${doc.fileType}) attached to ${claim.claimNumber} by ${caller.kind}`);
    await generateAndStoreClaimPdf({ claimId: claim.id, companyId: caller.companyId, kind: 'report', reason: 'documents_added' });
    return NextResponse.json({
      success: true,
      pending: false,
      url: documentUrl(claim.id, doc.id),
      documentId: doc.id,
      claimNumber: claim.claimNumber,
      fileName: doc.fileName,
      size: doc.fileSize,
      mimeType: doc.fileType,
    });
  } catch (error) {
    console.error('[MEDIA UPLOAD] Error:', error);
    return NextResponse.json({ success: false, error: 'Upload failed' }, { status: 500 });
  }
}
