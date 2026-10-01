import { NextRequest } from 'next/server';
import { getClaimPdf, regenerateClaimPdf } from '@/lib/pdf/pdfRoute';

export const dynamic = 'force-dynamic';

/** GET /api/claims/[claimNumber]/pdf - the claim report PDF (see lib/pdf/pdfRoute.ts). */
export async function GET(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  return getClaimPdf(request, params.claimNumber, 'report');
}

/** POST /api/claims/[claimNumber]/pdf - regenerate and store the claim report. */
export async function POST(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  return regenerateClaimPdf(request, params.claimNumber, 'report');
}
