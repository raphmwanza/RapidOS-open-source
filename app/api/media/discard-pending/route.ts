import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { isValidInternalApiKey } from '@/lib/middleware';
import { discardPendingMedia } from '@/lib/storage/documents';

export const dynamic = 'force-dynamic';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/media/discard-pending  { customerId }
 * WhatsApp bot only (internal API key + X-Company-ID): the customer cancelled
 * the claim they were filing, so the photos/documents they sent for it are
 * deleted and can never attach to a later claim. Returns { discarded }.
 */
export async function POST(request: NextRequest) {
  if (!isValidInternalApiKey(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const companyId = request.headers.get('x-company-id') || '';
  if (!UUID.test(companyId)) return NextResponse.json({ error: 'X-Company-ID is required' }, { status: 400 });
  let customerId = '';
  try {
    customerId = String((await request.json())?.customerId || '').trim();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }
  if (!UUID.test(customerId)) return NextResponse.json({ error: 'customerId is required' }, { status: 400 });
  const customer = await prisma.customer.findFirst({ where: { id: customerId, companyId }, select: { id: true } });
  if (!customer) return NextResponse.json({ error: 'Customer not found in this company' }, { status: 404 });
  const discarded = await discardPendingMedia(companyId, customerId);
  if (discarded) console.info(`[media] discarded ${discarded} pending file(s) of customer ${customerId} after a cancelled claim`);
  return NextResponse.json({ success: true, discarded });
}
