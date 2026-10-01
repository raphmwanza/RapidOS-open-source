import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';
import { ADMIN_ROLES, assignableRoles, canManageAccount, isUserRole } from '@/lib/users/roles';
import {
  activeSuperAdminCount, audit, cleanName, lockCompanyAccounts, noStore, revokeSessions, userSelect, validateName, type UserErrors,
} from '@/lib/users/service';

class UserError extends Error {
  constructor(public code: string, public status: number) { super(code); }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * PATCH /api/users/:id: edit name, role, or active state of an account in the
 * caller's company. Nobody can change their own role/status, admins cannot
 * touch super admins, and the last active super admin can never be demoted or
 * deactivated.
 */
export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const error = await authMiddleware(request, { requiredRole: [...ADMIN_ROLES] });
  if (error) return error;
  const actor = (request as any).admin;
  if (!UUID.test(params.id)) return NextResponse.json({ error: 'not_found' }, { status: 404, headers: noStore });

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: noStore });

  const data: { firstName?: string; lastName?: string; role?: string; isActive?: boolean } = {};
  const fields: UserErrors = {};
  for (const key of ['firstName', 'lastName'] as const) {
    if (body[key] === undefined) continue;
    const value = cleanName(body[key]);
    const problem = validateName(value);
    if (problem) fields[key] = problem; else data[key] = value;
  }
  if (body.role !== undefined) {
    const role = typeof body.role === 'string' ? body.role.toUpperCase() : '';
    if (isUserRole(role)) data.role = role; else fields.role = 'invalid_role';
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive === 'boolean') data.isActive = body.isActive; else return NextResponse.json({ error: 'invalid_body' }, { status: 400, headers: noStore });
  }
  if (Object.keys(fields).length) return NextResponse.json({ error: 'validation_failed', fields }, { status: 400, headers: noStore });
  if (!Object.keys(data).length) return NextResponse.json({ error: 'nothing_to_update' }, { status: 400, headers: noStore });

  try {
    const { before, after } = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      await lockCompanyAccounts(tx, actor.companyId);
      // Tenant scope: an id from another company is indistinguishable from a missing one.
      const target = await tx.admin.findFirst({ where: { id: params.id, companyId: actor.companyId }, select: { id: true, role: true, isActive: true, firstName: true, lastName: true } });
      if (!target) throw new UserError('not_found', 404);
      if (!canManageAccount(actor.role, target.role)) throw new UserError('forbidden_target', 403);

      const roleChanging = data.role !== undefined && data.role !== target.role;
      const statusChanging = data.isActive !== undefined && data.isActive !== target.isActive;
      if (target.id === actor.id && (roleChanging || statusChanging)) throw new UserError('cannot_change_self', 400);
      if (roleChanging && !assignableRoles(actor.role).includes(data.role as any)) throw new UserError('forbidden_role', 403);

      const losesSuperAdmin = target.role === 'SUPER_ADMIN' && target.isActive && ((roleChanging && data.role !== 'SUPER_ADMIN') || data.isActive === false);
      if (losesSuperAdmin && (await activeSuperAdminCount(tx, actor.companyId, target.id)) === 0) throw new UserError('last_super_admin', 409);

      const updated = await tx.admin.update({ where: { id: target.id }, data, select: userSelect });
      if (data.isActive === false) await revokeSessions(tx, target.id);
      return { before: target, after: updated };
    });
    const action = data.isActive === false ? 'user.deactivate' : data.isActive === true && !before.isActive ? 'user.reactivate' : 'user.update';
    await audit(request, actor.id, action, after.id,
      { role: before.role, isActive: before.isActive, firstName: before.firstName, lastName: before.lastName },
      { role: after.role, isActive: after.isActive, firstName: after.firstName, lastName: after.lastName });
    return NextResponse.json({ user: after }, { headers: noStore });
  } catch (err) {
    if (err instanceof UserError) return NextResponse.json({ error: err.code }, { status: err.status, headers: noStore });
    return NextResponse.json({ error: 'update_failed' }, { status: 500, headers: noStore });
  }
}
