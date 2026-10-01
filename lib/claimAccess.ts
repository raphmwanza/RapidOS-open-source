/**
 * Resolves which claim a request may touch, scoped to one company.
 *
 * - Dashboard: a valid admin JWT; the claim is looked up inside the admin's
 *   company only, so another company's claim answers 404 exactly like a claim
 *   that does not exist (no 403 that would confirm the claim number exists).
 * - WhatsApp document links: a signed PDF access token bound to the claim
 *   number and the company it was issued for.
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyPdfAccessToken } from '@/lib/auth';
import { authMiddleware, getAdminFromRequest, type AuthMiddlewareOptions } from '@/lib/middleware';

export interface ClaimAccess {
  claim: { id: string; claimNumber: string; companyId: string; customerId: string };
  admin: { id: string; companyId: string; role: string; email: string } | null;
  companyId: string;
}

const claimSelect = { id: true, claimNumber: true, companyId: true, customerId: true } as const;

export async function resolveClaimAccess(
  request: NextRequest,
  claimNumber: string,
  opts: { allowPdfToken?: boolean; auth?: AuthMiddlewareOptions } = {}
): Promise<ClaimAccess | NextResponse> {
  const accessToken = opts.allowPdfToken ? request.nextUrl.searchParams.get('accessToken') : null;
  if (accessToken) {
    const grant = verifyPdfAccessToken(accessToken, claimNumber);
    if (!grant) return NextResponse.json({ error: 'Invalid or expired access token' }, { status: 401 });
    const claim = await prisma.claim.findFirst({ where: { claimNumber, companyId: grant.companyId }, select: claimSelect });
    if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
    return { claim, admin: null, companyId: grant.companyId };
  }

  const authError = await authMiddleware(request, opts.auth || {});
  if (authError) return authError;
  const admin = getAdminFromRequest(request);
  if (!admin) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const claim = await prisma.claim.findFirst({ where: { claimNumber, companyId: admin.companyId }, select: claimSelect });
  if (!claim) return NextResponse.json({ error: 'Claim not found' }, { status: 404 });
  return { claim, admin, companyId: admin.companyId };
}
