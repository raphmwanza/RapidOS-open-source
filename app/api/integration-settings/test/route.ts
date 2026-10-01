import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/lib/middleware';
import { getBackendUrl } from '@/lib/apiConfig';
import { prisma } from '@/lib/prisma';
import { decryptSecret } from '@/lib/encryption';
import { ADMIN_ROLES } from '@/lib/users/roles';
import { WEBHOOK_PATH, isPublicHttpsUrl, webhookCallbackUrl } from '@/lib/whatsapp/webhook';

type Probe = { ok: boolean; status: number | null; url: string };

/** Performs Meta's GET verification handshake against a webhook URL. */
async function probeWebhook(callbackUrl: string, token: string): Promise<Probe> {
  const challenge = crypto.randomBytes(8).toString('hex');
  const url = new URL(callbackUrl);
  url.searchParams.set('hub.mode', 'subscribe');
  url.searchParams.set('hub.verify_token', token);
  url.searchParams.set('hub.challenge', challenge);
  try {
    const res = await fetch(url, { cache: 'no-store', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'ngrok-skip-browser-warning': '1' } });
    const body = await res.text();
    return { ok: res.status === 200 && body.trim() === challenge, status: res.status, url: callbackUrl };
  } catch {
    return { ok: false, status: null, url: callbackUrl };
  }
}

// Runs against the backend because only it can decrypt the tenant LLM key.
export async function POST(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const admin = (request as any).admin;
  try {
    const body = await request.json().catch(() => ({}));
    if (body.test === 'connection') {
      const settings = await prisma.integrationSettings.findUnique({ where: { companyId: admin.companyId }, select: { whatsappDisplayNumber: true, whatsappPhoneNumberId: true, whatsappBusinessAccountId: true, whatsappAccessTokenCipher: true } });
      if (!settings?.whatsappDisplayNumber || !settings.whatsappPhoneNumberId || !settings.whatsappBusinessAccountId || !settings.whatsappAccessTokenCipher) return NextResponse.json({ error: 'connection_incomplete' }, { status: 400 });
      return NextResponse.json({ message: 'connection_complete' });
    }
    if (body.test === 'webhook') {
      const settings = await prisma.integrationSettings.findUnique({ where: { companyId: admin.companyId }, select: { webhookVerifyTokenCipher: true, publicBaseUrl: true } });
      if (!settings?.webhookVerifyTokenCipher) return NextResponse.json({ error: 'verify_token_missing' }, { status: 400 });
      const token = decryptSecret(settings.webhookVerifyTokenCipher);
      // 1. The Go API itself (internal network) must accept the saved token.
      const backend = await probeWebhook(`${getBackendUrl()}${WEBHOOK_PATH}`, token);
      // 2. The public URL Meta will call, when one is configured and reachable over HTTPS.
      const publicUrl = settings.publicBaseUrl && isPublicHttpsUrl(settings.publicBaseUrl) ? await probeWebhook(webhookCallbackUrl(settings.publicBaseUrl), token) : null;
      return NextResponse.json({ backend: { ok: backend.ok, status: backend.status }, public: publicUrl }, { status: backend.ok && (!publicUrl || publicUrl.ok) ? 200 : 502 });
    }
    const response = await fetch(`${getBackendUrl()}/api/v1/internal/test-bot`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Internal-API-Key': process.env.INTERNAL_API_KEY || '' },
      body: JSON.stringify({ companyId: admin.companyId }), cache: 'no-store',
    });
    const data = await response.json();
    return NextResponse.json(data, { status: response.status });
  } catch {
    return NextResponse.json({ error: 'backend_unreachable' }, { status: 502 });
  }
}
