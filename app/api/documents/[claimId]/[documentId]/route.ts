import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { readDocumentBytes } from '@/lib/storage/documents';
import { contentDisposition } from '@/lib/pdf/claimPdfService';

export const dynamic = 'force-dynamic';

const INLINE = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'application/pdf'];
const inlineTypes = new Set(INLINE);
const allowedMimeTypes = new Set(INLINE.concat(['image/heic', 'image/heif', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain']));

/** GET - a claim document's bytes (company-scoped). ?download=1 forces an attachment. */
export async function GET(request: NextRequest, { params }: { params: { claimId: string; documentId: string } }) {
  const authError = await authMiddleware(request, { requireCompanyAccess: true });
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  try {
    const document = await prisma.claimDocument.findFirst({
      // Scoped to the caller's company: another company's document is "not found", never "forbidden".
      where: { id: params.documentId, claimId: params.claimId, claim: { companyId: admin.companyId } },
      select: { fileName: true, fileType: true, filePath: true, base64Data: true },
    });
    if (!document) return NextResponse.json({ error: 'Document not found' }, { status: 404 });
    const buffer = await readDocumentBytes(document, admin.companyId);
    if (!buffer || buffer.length === 0) return NextResponse.json({ error: 'Document file is missing' }, { status: 404 });
    const contentType = allowedMimeTypes.has(document.fileType) ? document.fileType : 'application/octet-stream';
    const download = request.nextUrl.searchParams.get('download') === '1' || !inlineTypes.has(contentType);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': contentDisposition(download ? 'attachment' : 'inline', document.fileName),
        'X-Content-Type-Options': 'nosniff',
        // Chrome's PDF viewer does not run in a sandboxed document.
        ...(contentType === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox" }),
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('[documents] read failed:', error);
    return NextResponse.json({ error: 'Unable to retrieve document' }, { status: 500 });
  }
}
