import { NextRequest } from 'next/server';
import { getClaimPdf, regenerateClaimPdf } from '@/lib/pdf/pdfRoute';

export const dynamic = 'force-dynamic';

/** GET /api/claims/[claimNumber]/status-pdf - the latest claim status summary PDF. */
export async function GET(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  return getClaimPdf(request, params.claimNumber, 'status');
}

export async function POST(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  return regenerateClaimPdf(request, params.claimNumber, 'status');
}
