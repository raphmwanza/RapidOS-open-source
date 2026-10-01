/** Shared handlers for the claim PDF routes (report and status summary). */
import { NextRequest, NextResponse } from 'next/server';
import { resolveClaimAccess } from '@/lib/claimAccess';
import { buildClaimPdf, contentDisposition, generateAndStoreClaimPdf, getOrCreateClaimPdf, type ClaimPdfKind } from './claimPdfService';

function pdfResponse(buffer: Buffer, fileName: string, download: boolean) {
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(buffer.length),
      'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', fileName),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

/**
 * GET: serves the stored PDF (generated and stored first if missing).
 *   ?download=1   attachment instead of inline
 *   ?regenerate=1 (dashboard only) re-render and store before serving
 *   ?lang=xx      (dashboard only) render in another language without storing
 * Auth: dashboard JWT (claim must be in the admin's company, else 403) or a
 * signed PDF access token (WhatsApp document links).
 */
export async function getClaimPdf(request: NextRequest, claimNumber: string, kind: ClaimPdfKind) {
  const access = await resolveClaimAccess(request, claimNumber, { allowPdfToken: true });
  if (access instanceof NextResponse) return access;
  const q = request.nextUrl.searchParams;
  const download = q.get('download') === '1';
  try {
    const lang = access.admin ? q.get('lang') : null;
    if (lang) {
      const built = await buildClaimPdf(access.claim.id, access.companyId, kind, lang);
      if (!built) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
      return pdfResponse(built.buffer, built.fileName, download);
    }
    if (access.admin && q.get('regenerate') === '1') {
      await generateAndStoreClaimPdf({ claimId: access.claim.id, companyId: access.companyId, kind, reason: 'manual' });
    }
    const pdf = await getOrCreateClaimPdf(access.claim.id, access.companyId, kind);
    if (!pdf) return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
    return pdfResponse(pdf.buffer, pdf.fileName, download);
  } catch (error) {
    console.error(`[PDF] ${kind} PDF request for ${claimNumber} failed:`, error);
    return NextResponse.json({ error: 'Failed to generate PDF' }, { status: 500 });
  }
}

/** POST: (re)generate and store the PDF, returns its document metadata. Dashboard only. */
export async function regenerateClaimPdf(request: NextRequest, claimNumber: string, kind: ClaimPdfKind) {
  const access = await resolveClaimAccess(request, claimNumber);
  if (access instanceof NextResponse) return access;
  const stored = await generateAndStoreClaimPdf({ claimId: access.claim.id, companyId: access.companyId, kind, reason: 'manual' });
  if (!stored) return NextResponse.json({ success: false, error: 'Failed to generate PDF' }, { status: 500 });
  return NextResponse.json({ success: true, ...stored, pdfPath: `/api/claims/${access.claim.claimNumber}/pdf` });
}
