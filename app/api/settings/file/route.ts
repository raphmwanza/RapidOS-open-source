import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { ADMIN_ROLES } from '@/lib/users/roles';
import { readStoredFile } from '@/lib/storage/fileStore';
import { contentDisposition } from '@/lib/pdf/claimPdfService';

export const dynamic = 'force-dynamic';

const TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain; charset=utf-8',
  md: 'text/plain; charset=utf-8',
  csv: 'text/plain; charset=utf-8',
  json: 'text/plain; charset=utf-8',
  xml: 'text/plain; charset=utf-8',
};

/** GET ?key=companies/<companyId>/knowledge/<file> - a knowledge document's bytes (company-scoped). */
export async function GET(request: NextRequest) {
  const authError = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin?.companyId) return NextResponse.json({ error: 'Authentication required' }, { status: 401 });

  const key = request.nextUrl.searchParams.get('key') || '';
  if (!/^companies\/[0-9a-f-]{36}\/knowledge\/[^/]+$/i.test(key)) {
    return NextResponse.json({ error: 'Invalid document' }, { status: 400 });
  }
  // readStoredFile refuses keys outside the caller's company folder.
  const buffer = await readStoredFile(key, admin.companyId);
  if (!buffer) return NextResponse.json({ error: 'Document not found' }, { status: 404 });

  const fileName = key.split('/').pop()!.replace(/^[0-9a-f-]{36}-/i, '');
  const ext = fileName.split('.').pop()?.toLowerCase() || '';
  const contentType = TYPES[ext] || 'application/octet-stream';
  const inline = contentType !== 'application/octet-stream';
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(buffer.length),
      'Content-Disposition': contentDisposition(inline ? 'inline' : 'attachment', fileName),
      'X-Content-Type-Options': 'nosniff',
      ...(contentType === 'application/pdf' ? {} : { 'Content-Security-Policy': "default-src 'none'; sandbox" }),
      'Cache-Control': 'private, no-store',
    },
  });
}
