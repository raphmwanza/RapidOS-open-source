import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { resolveClaimAccess } from '@/lib/claimAccess';

export const dynamic = 'force-dynamic';

/** GET - the claim's documents (metadata only, company-scoped). */
export async function GET(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  const access = await resolveClaimAccess(request, params.claimNumber);
  if (access instanceof NextResponse) return access;
  try {
    const documents = await prisma.claimDocument.findMany({
      where: { claimId: access.claim.id },
      select: { id: true, fileName: true, fileType: true, fileSize: true, uploadedBy: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    return NextResponse.json({
      success: true,
      documents: documents.map((d: { id: string }) => ({ ...d, url: `/api/documents/${access.claim.id}/${d.id}` })),
    });
  } catch (error) {
    console.error('Error fetching documents:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
