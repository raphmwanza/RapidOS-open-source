import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getOrCreateClaimPdf } from '@/lib/pdf/claimPdfService';
import { authOrInternalKeyMiddleware, getAdminFromRequest, getBackendInternalHeaders, isValidInternalApiKey } from '@/lib/middleware';
import { loadMessages, normalizeLocale, translate, type Locale } from '@/lib/i18n';
import { generatePdfAccessToken } from '@/lib/auth';

// May generate PDF + send via WhatsApp
export const maxDuration = 30; // seconds

/**
 * POST /api/customers/pdf/retrieve
 * Retrieve existing PDF for claim or generate new one if needed, then send to customer
 */
export async function POST(request: NextRequest) {
  // Dashboard session, or the Go backend (internal API key + X-Company-ID)
  // after a claim status change.
  const authError = await authOrInternalKeyMiddleware(request);
  if (authError) return authError;

  const admin = getAdminFromRequest(request);
  const companyId = admin?.companyId || (isValidInternalApiKey(request) ? request.headers.get('x-company-id') : null);
  if (!companyId) {
    return NextResponse.json({ error: 'Company context is required' }, { status: 403 });
  }

  try {
    const { claimNumber, reason = 'status_updated' } = await request.json();
    
    console.log(`📄 [CUSTOMER PDF RETRIEVE API] Processing PDF retrieve request for claim ${claimNumber}, reason: ${reason}`);
    
    if (!claimNumber) {
      return NextResponse.json(
        { success: false, error: 'Claim number is required' },
        { status: 400 }
      );
    }

    // Validate reason
    const validReasons = ['claim_created', 'status_updated', 'notes_added', 'customer_requested'];
    if (!validReasons.includes(reason)) {
      return NextResponse.json(
        { success: false, error: 'Invalid reason' },
        { status: 400 }
      );
    }

    // Get claim data with customer info
    const claim = await prisma.claim.findFirst({
      where: { claimNumber, companyId },
      include: {
        customer: true,
        company: true
      }
    });

    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    if (!claim.customer?.phoneNumber) {
      return NextResponse.json(
        { success: false, error: 'Customer phone number not found' },
        { status: 400 }
      );
    }

    // Automated sends (the Go backend after a status change) respect a bot
    // paused by support on this customer's conversation. A staff member's own
    // send from the dashboard still goes out.
    if (!admin) {
      const paused = await prisma.conversation.findFirst({
        where: { companyId, customerId: claim.customerId, isActive: true, isBotPaused: true },
        select: { id: true },
      });
      if (paused) {
        console.log(`⏸️ [CUSTOMER PDF RETRIEVE API] Bot paused on conversation ${paused.id}: PDF for ${claimNumber} not sent`);
        return NextResponse.json({ success: true, skipped: 'bot_paused' });
      }
    }

    // The stored report (the status route regenerates it on every change);
    // generated now when the claim has none yet.
    const pdf = await getOrCreateClaimPdf(claim.id, companyId, 'report');
    if (!pdf) {
      return NextResponse.json(
        { success: false, error: 'Failed to generate PDF' },
        { status: 500 }
      );
    }
    const pdfPath = `/api/claims/${claimNumber}/pdf`;

    // Send PDF to customer via WhatsApp
    const success = await sendPDFToCustomer(
      claim.customer.phoneNumber,
      claimNumber,
      claim.companyId,
      claim.company.name,
      normalizeLocale(claim.language) || normalizeLocale(claim.company.botLanguage) || 'en',
      pdfPath,
      pdf.fileName,
      reason
    );
    
    if (success) {
      console.log(`✅ [CUSTOMER PDF RETRIEVE API] PDF sent successfully to customer for claim ${claimNumber}`);
      return NextResponse.json({
        success: true,
        message: 'PDF sent successfully to customer'
      });
    } else {
      console.error(`❌ [CUSTOMER PDF RETRIEVE API] Failed to send PDF to customer for claim ${claimNumber}`);
      return NextResponse.json(
        { success: false, error: 'Failed to send PDF to customer' },
        { status: 500 }
      );
    }
    
  } catch (error) {
    console.error('❌ [CUSTOMER PDF RETRIEVE API] Error processing PDF retrieve request:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

/**
 * Send PDF to customer via WhatsApp using backend service
 */
async function sendPDFToCustomer(
  customerPhone: string,
  claimNumber: string,
  companyId: string,
  companyName: string,
  botLanguage: Locale,
  pdfPath: string,
  fileName: string,
  reason: string
): Promise<boolean> {
  try {
    const baseUrl = process.env.NEXT_PUBLIC_BASE_URL;
    if (!baseUrl) throw new Error('NEXT_PUBLIC_BASE_URL is required to send PDF links');
    const pdfAccessToken = generatePdfAccessToken(claimNumber, companyId);
    const fullPdfUrl = `${baseUrl}${pdfPath}?accessToken=${encodeURIComponent(pdfAccessToken)}`;
    
    // Message and caption in the company's bot language (English for missing keys)
    const kind = ['status_updated', 'notes_added', 'customer_requested'].includes(reason) ? reason : 'default';
    await loadMessages(botLanguage);
    const t = (key: Parameters<typeof translate>[1]) => translate(botLanguage, key, { claimNumber });
    const message = `📄 *${companyName} - ${t(`botPdf.title.${kind}` as Parameters<typeof translate>[1])}*\n\n${t(`botPdf.body.${kind}` as Parameters<typeof translate>[1])}\n\n${t('botPdf.footer')}`;
    const caption = kind === 'status_updated' ? t('botPdf.captionUpdated') : t('botPdf.caption');

    // Send document via backend WhatsApp service with inline viewing preference
    const backendUrl = (await import('@/lib/apiConfig')).getBackendUrl();
    
    let backendHeaders: Record<string, string>;
    try {
      backendHeaders = getBackendInternalHeaders(companyId);
    } catch {
      return false;
    }

    const response = await fetch(`${backendUrl}/api/v1/internal/send-document`, {
      method: 'POST',
      headers: backendHeaders,
      body: JSON.stringify({
        customerPhone: customerPhone,
        documentUrl: fullPdfUrl,
        filename: fileName,
        caption: caption,
        inline: true // Preference for inline viewing
      }),
    });

    if (response.ok) {
      console.log(`✅ [PDF SEND] Successfully sent PDF document to ${customerPhone}`);
      
      // Also send the explanatory message
      await fetch(`${backendUrl}/api/v1/internal/notifications/send`, {
        method: 'POST',
        headers: backendHeaders,
        body: JSON.stringify({
          to: customerPhone,
          message: message,
          type: 'pdf_notification'
        }),
      });
      
      return true;
    } else {
      const errorText = await response.text();
      console.error(`❌ [PDF SEND] Failed to send PDF document to ${customerPhone}: ${errorText}`);
      return false;
    }

  } catch (error) {
    console.error(`❌ [PDF SEND] Error sending PDF to customer:`, error);
    return false;
  }
}
