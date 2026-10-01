import { NextRequest, NextResponse } from 'next/server';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authMiddleware, rateLimitMiddleware } from '@/lib/middleware';
import { normalizeLocale } from '@/lib/i18n';
import { ADMIN_ROLES, assignableRoles, isUserRole } from '@/lib/users/roles';
import {
  audit, cleanName, generatePassword, noStore, normalizeEmail, userSelect, validateEmail, validateName, type UserErrors,
} from '@/lib/users/service';

/** GET /api/users: every account in the caller's company (admins only). */
export async function GET(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const actor = (request as any).admin;
  const users = await prisma.admin.findMany({
    where: { companyId: actor.companyId },
    select: userSelect,
    orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
  });
  return NextResponse.json(
    { users, me: { id: actor.id, role: actor.role }, assignableRoles: assignableRoles(actor.role) },
    { headers: noStore },
  );
}

/**
 * POST /api/users: creates an account in the caller's company. The password is
 * generated server-side (UUID), bcrypt-hashed, and returned exactly once.
 */
export async function POST(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const actor = (request as any).admin;
  if (!rateLimitMiddleware(`users:create:${actor.id}`, 60 * 60 * 1000, 30)) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: noStore });

  const firstName = cleanName(body.firstName);
  const lastName = cleanName(body.lastName);
  const email = normalizeEmail(body.email);
  const role = typeof body.role === 'string' ? body.role.toUpperCase() : '';
  const uiLanguage = body.uiLanguage ? normalizeLocale(body.uiLanguage) : null;

  const fields: UserErrors = {};
  const firstNameError = validateName(firstName); if (firstNameError) fields.firstName = firstNameError;
  const lastNameError = validateName(lastName); if (lastNameError) fields.lastName = lastNameError;
  const emailError = validateEmail(email); if (emailError) fields.email = emailError;
  if (!isUserRole(role)) fields.role = 'invalid_role';
  if (body.uiLanguage && !uiLanguage) fields.uiLanguage = 'invalid_language';
  if (Object.keys(fields).length) return NextResponse.json({ error: 'validation_failed', fields }, { status: 400, headers: noStore });
  if (!isUserRole(role) || !assignableRoles(actor.role).includes(role)) {
    return NextResponse.json({ error: 'forbidden_role', fields: { role: 'forbidden_role' } }, { status: 403, headers: noStore });
  }

  // Emails are unique across all companies (they identify the login).
  if (await prisma.admin.findUnique({ where: { email }, select: { id: true } })) {
    return NextResponse.json({ error: 'email_taken', fields: { email: 'email_taken' } }, { status: 409, headers: noStore });
  }

  const { password, passwordHash } = await generatePassword();
  try {
    // Access is decided by `role` alone (see lib/users/roles.ts); no admin_permissions row.
    const user = await prisma.admin.create({
      data: { email, firstName, lastName, passwordHash, role, isActive: true, companyId: actor.companyId, createdById: actor.id, uiLanguage },
      select: userSelect,
    });
    await audit(request, actor.id, 'user.create', user.id, undefined, { email, role });
    return NextResponse.json({ user, password }, { status: 201, headers: noStore });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      return NextResponse.json({ error: 'email_taken', fields: { email: 'email_taken' } }, { status: 409, headers: noStore });
    }
    return NextResponse.json({ error: 'create_failed' }, { status: 500, headers: noStore });
  }
}
