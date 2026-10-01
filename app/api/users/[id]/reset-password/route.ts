import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authMiddleware, rateLimitMiddleware } from '@/lib/middleware';
import { ADMIN_ROLES, canManageAccount } from '@/lib/users/roles';
import { audit, generatePassword, noStore, revokeSessions } from '@/lib/users/service';
import { clearLoginFailures } from '@/lib/loginLockout';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/users/:id/reset-password: replaces the password of another account
 * in the caller's company with a new generated UUID (returned once) and signs
 * that user out of every session: refresh tokens are revoked and tokenVersion is
 * bumped, so access tokens already issued get 401 on their next request.
 */
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const actor = (request as any).admin;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });
  if (params.id === actor.id) return NextResponse.json({ error: 'cannot_reset_self' }, { status: 400, headers: noStore });
  if (!rateLimitMiddleware(`users:reset:${actor.id}`, 60 * 60 * 1000, 30)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }

  const target = await prisma.admin.findFirst({ where: { id: params.id, companyId: actor.companyId }, select: { id: true, email: true, role: true } });
  if (!target) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });
  if (!canManageAccount(actor.role, target.role)) return NextResponse.json({ error: 'forbidden_target' }, { status: 403, headers: noStore });

  const { password, passwordHash } = await generatePassword();
  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await tx.admin.update({ where: { id: target.id }, data: { passwordHash } });
      await revokeSessions(tx, target.id);
    });
  } catch {
    return NextResponse.json({ error: 'reset_failed' }, { status: 500, headers: noStore });
  }
  // The new password should work right away even if the account was locked out.
  await clearLoginFailures(target.email);
  await audit(request, actor.id, 'user.reset_password', target.id);
  return NextResponse.json({ email: target.email, password }, { headers: noStore });
}
