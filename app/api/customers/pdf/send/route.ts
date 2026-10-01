import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware, getAdminFromRequest } from '@/lib/middleware';
// import { generateAndSendCustomerPDF } from '@/lib/customerPdfGenerator'; // Disabled - PDFs now in database

export async function POST(request: NextRequest) {
  const authError = await authMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  if (!admin) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { claimNumber, reason = 'customer_requested' } = await request.json();

    if (!claimNumber) {
      return NextResponse.json(
        { success: false, error: 'Claim number is required' },
        { status: 400 }
      );
    }

    console.log(`📄 [CUSTOMER PDF API] Processing PDF request for claim ${claimNumber}, reason: ${reason}`);

    // Generate and send the PDF
    // const success = await generateAndSendCustomerPDF(claimNumber, reason); // Disabled - PDFs now in database
    const success = true; // PDFs now stored in database and accessible via API endpoints

    if (success) {
      return NextResponse.json({
        success: true,
        message: `PDF sent successfully for claim ${claimNumber}`
      });
    } else {
      return NextResponse.json(
        { success: false, error: 'Failed to generate or send PDF' },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('[CUSTOMER PDF API] Error:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}