import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';
import { decryptSecret } from '@/lib/encryption';
import { ADMIN_ROLES } from '@/lib/users/roles';

// The verify token must be pasted into Meta, so admins may reveal it on demand.
// The access token and app secret stay write-only.
export async function GET(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const admin = (request as any).admin;
  const headers = { 'Cache-Control': 'no-store' };
  const row = await prisma.integrationSettings.findUnique({ where: { companyId: admin.companyId }, select: { webhookVerifyTokenCipher: true } });
  if (!row?.webhookVerifyTokenCipher) return NextResponse.json({ token: null }, { headers });
  try {
    return NextResponse.json({ token: decryptSecret(row.webhookVerifyTokenCipher) }, { headers });
  } catch {
    return NextResponse.json({ error: 'decrypt_failed' }, { status: 500, headers });
  }
}
