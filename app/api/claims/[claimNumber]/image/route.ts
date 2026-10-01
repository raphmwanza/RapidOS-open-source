import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveClaimAccess } from '@/lib/claimAccess';
import { readDocumentBytes } from '@/lib/storage/documents';
import { contentDisposition } from '@/lib/pdf/claimPdfService';

export const dynamic = 'force-dynamic';

/** GET ?index=n - the n-th image of the claim (company-scoped). */
export async function GET(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  const access = await resolveClaimAccess(request, params.claimNumber);
  if (access instanceof NextResponse) return access;
  try {
    const index = Math.max(0, parseInt(request.nextUrl.searchParams.get('index') || '0', 10) || 0);
    const images = await prisma.claimDocument.findMany({
      where: { claimId: access.claim.id, fileType: { startsWith: 'image/' } },
      orderBy: { createdAt: 'asc' },
      select: { fileName: true, fileType: true, filePath: true, base64Data: true },
    });
    const document = images[index] || images[0];
    const buffer = document ? await readDocumentBytes(document, access.companyId) : null;
    if (!document || !buffer) return NextResponse.json({ error: 'No image found' }, { status: 404 });
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': document.fileType,
        'Content-Length': String(buffer.length),
        'Content-Disposition': contentDisposition('inline', document.fileName),
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    console.error('Error serving image:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
