import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { generateAndStoreClaimPdf, systemUploader } from '@/lib/pdf/claimPdfService';

// Bulk PDF generation can take a long time
export const maxDuration = 60; // seconds

/** POST {action:'generate-all'} - generate the report PDF for every claim of the company that has none. */
export async function POST(request: NextRequest) {
  const authError = await authMiddleware(request, { requiredRole: ['SUPER_ADMIN', 'ADMIN'] });
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  try {
    const { action } = await request.json();
    if (action !== 'generate-all') return NextResponse.json({ success: false, error: 'Invalid action' }, { status: 400 });

    const claims = await prisma.claim.findMany({
      where: { companyId: admin.companyId },
      select: { id: true, claimNumber: true, documents: { where: { uploadedBy: systemUploader('report') }, select: { id: true } } },
      orderBy: { createdAt: 'desc' },
    });
    let generated = 0;
    let skipped = 0;
    let errors = 0;
    for (const claim of claims) {
      if (claim.documents.length) { skipped++; continue; }
      const stored = await generateAndStoreClaimPdf({ claimId: claim.id, companyId: admin.companyId, kind: 'report', reason: 'bulk' });
      if (stored) generated++; else errors++;
    }
    return NextResponse.json({ success: true, message: 'PDF generation process completed', summary: { total: claims.length, generated, skipped, errors } });
  } catch (error) {
    console.error('PDF bulk generation error:', error);
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
