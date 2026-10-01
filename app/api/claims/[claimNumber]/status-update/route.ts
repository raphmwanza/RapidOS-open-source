import { NextRequest } from 'next/server';
import { getClaimPdf } from '@/lib/pdf/pdfRoute';

export const dynamic = 'force-dynamic';

// Status changes go through PUT /api/clients/[id]/claims/[claimNumber]/status,
// which records history, regenerates the PDFs and asks the backend for the
// localized WhatsApp message. This route only serves the status summary PDF.
export async function GET(request: NextRequest, { params }: { params: { claimNumber: string } }) {
  return getClaimPdf(request, params.claimNumber, 'status');
}
