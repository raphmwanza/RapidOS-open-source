import { isToggleEnabled } from '@/lib/company/preferences';
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, getAdminFromRequest, getBackendInternalHeaders } from '@/lib/middleware';
import { loadMessages, normalizeLocale, translate, DEFAULT_LOCALE } from '@/lib/i18n';
import { claimStatusLabel } from '@/lib/i18n/claimLabels';
import { generateAndStoreClaimPdf } from '@/lib/pdf/claimPdfService';

// PUT - Update claim status
export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string; claimNumber: string } }
) {
  try {
    // Active account, current token version; read-only roles cannot write.
    const authError = await authMiddleware(request);
    if (authError) return authError;
    const admin = getAdminFromRequest(request)!;

    const { claimNumber } = params;
    const body = await request.json();
  const { status, reason, autoGeneratePdf: _autoGeneratePdf = false } = body;

    // Validate status
    const validStatuses = ['NEW', 'ONGOING', 'APPROVED', 'REJECTED', 'COMPLETED'];
    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { success: false, error: 'Invalid status' },
        { status: 400 }
      );
    }

    // Find the claim
    const claim = await prisma.claim.findFirst({
      where: {
        claimNumber: claimNumber,
        companyId: admin.companyId
      },
      include: {
        customer: true
      }
    });

    if (!claim) {
      return NextResponse.json(
        { success: false, error: 'Claim not found' },
        { status: 404 }
      );
    }

    const oldStatus = claim.status;

    // Update claim status
    const updatedClaim = await prisma.claim.update({
      where: { id: claim.id },
      data: {
        status: status,
        ...(status === 'APPROVED' && { approvedAt: new Date() }),
        ...(status === 'REJECTED' && { rejectedAt: new Date() }),
        ...(status === 'COMPLETED' && { completedAt: new Date() }),
        updatedAt: new Date()
      }
    });

    // Create status history entry
    await prisma.claimStatusHistory.create({
      data: {
        claimId: claim.id,
        fromStatus: oldStatus,
        toStatus: status,
        reason: reason || null,
        changedBy: admin.id,
        changedAt: new Date()
      }
    });

    // Add a note about the status change, in the dashboard language of whoever changed it
    const author = await prisma.admin.findUnique({ where: { id: admin.id }, select: { uiLanguage: true, company: { select: { uiLanguage: true } } } });
    const noteLocale = normalizeLocale(author?.uiLanguage) || normalizeLocale(author?.company?.uiLanguage) || DEFAULT_LOCALE;
    await loadMessages(noteLocale);
    const t = (key: Parameters<typeof translate>[1], vars?: Parameters<typeof translate>[2]) => translate(noteLocale, key, vars);
    const noteText = t('claimDetail.statusNote', { from: claimStatusLabel(t, oldStatus), to: claimStatusLabel(t, status) })
      + (reason ? ` ${t('claimDetail.statusNoteReason', { reason })}` : '');
    await prisma.claimNote.create({
      data: {
        claimId: claim.id,
        content: noteText,
        isInternal: false,
        authorId: admin.id
      }
    });

    // Refresh the claim report and the status summary PDF before notifying,
    // so the PDF the backend sends to the customer shows the new status.
    const [reportPdf, statusPdf] = await Promise.all([
      generateAndStoreClaimPdf({ claimId: claim.id, companyId: admin.companyId, kind: 'report', reason: 'status_updated' }),
      generateAndStoreClaimPdf({ claimId: claim.id, companyId: admin.companyId, kind: 'status', reason: 'status_updated' }),
    ]);

    // Send automatic notification to customer via WhatsApp (semantic kernel will handle PDF generation)
    // Skipped when the company turned off "Notify customers when a claim status changes".
    let notification: { sent: boolean; language?: string; skipped?: string } = { sent: false };
    if (claim.customer?.phoneNumber && await isToggleEnabled(admin.companyId, 'notify_customer_status_updates')) {
      notification = await sendStatusUpdateNotification(
        admin.companyId,
        claim.customer.id,
        claim.customer.phoneNumber, 
        claimNumber, 
        status, 
        [claim.customer.firstName, claim.customer.lastName].filter(Boolean).join(' '),
        true // the backend also sends the claim PDF
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Status updated successfully',
      notification,
      pdf: { report: reportPdf, status: statusPdf },
      claim: {
        id: updatedClaim.id,
        claimNumber: updatedClaim.claimNumber,
        status: updatedClaim.status,
        updatedAt: updatedClaim.updatedAt.toISOString()
      }
    });

  } catch (error) {
    console.error('Error updating claim status:', error);
    return NextResponse.json(
      { success: false, error: 'Internal server error' },
      { status: 500 }
    );
  }
}

// Asks the Go backend to send the customer a WhatsApp status message. The
// backend picks the text from its per-language templates using the company's
// bot language (see backend/internal/service/botlocales).
async function sendStatusUpdateNotification(
  companyId: string,
  customerId: string,
  phoneNumber: string,
  claimNumber: string,
  status: string,
  customerName: string,
  autoGeneratePdf: boolean = true
): Promise<{ sent: boolean; language?: string; skipped?: string }> {
  try {
    const backendUrl = (await import('@/lib/apiConfig')).getBackendUrl();
    const response = await fetch(`${backendUrl}/api/v1/internal/notifications/status-update`, {
      method: 'POST',
      headers: getBackendInternalHeaders(companyId),
      body: JSON.stringify({
        companyId,
        customerId,
        claimNumber,
        status,
        customerPhone: phoneNumber,
        customerName,
        autoGeneratePdf,
        autoSendPdf: autoGeneratePdf,
      }),
    });
    const data = await response.json().catch(() => ({}));
    const language = data?.data?.language || data?.language;
    if (!response.ok) {
      console.error(`Failed to send WhatsApp status update for claim ${claimNumber}: HTTP ${response.status}`);
      return { sent: false, language };
    }
    // The bot is paused on the customer's conversation: support talks to them directly.
    if (data?.status === 'skipped') return { sent: false, language, skipped: String(data?.reason || 'skipped') };
    return { sent: true, language };
  } catch (error) {
    console.error('Error sending WhatsApp status update notification:', error);
    return { sent: false };
  }
}
