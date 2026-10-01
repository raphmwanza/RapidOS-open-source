import { NextRequest } from 'next/server';
import { regenerateClaimPdf } from '@/lib/pdf/pdfRoute';

export const dynamic = 'force-dynamic';

/** POST - (re)generate and store the claim report PDF. */
export async function POST(request: NextRequest, { params }: { params: { id: string; claimNumber: string } }) {
  return regenerateClaimPdf(request, params.claimNumber, 'report');
}
