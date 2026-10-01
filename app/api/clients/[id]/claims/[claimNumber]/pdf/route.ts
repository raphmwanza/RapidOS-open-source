import { NextRequest } from 'next/server';
import { getClaimPdf, regenerateClaimPdf } from '@/lib/pdf/pdfRoute';

export const dynamic = 'force-dynamic';

/** Same as /api/claims/[claimNumber]/pdf (kept for existing links). */
export async function GET(request: NextRequest, { params }: { params: { id: string; claimNumber: string } }) {
  return getClaimPdf(request, params.claimNumber, 'report');
}

export async function POST(request: NextRequest, { params }: { params: { id: string; claimNumber: string } }) {
  return regenerateClaimPdf(request, params.claimNumber, 'report');
}
