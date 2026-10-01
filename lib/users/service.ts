import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import type { NextRequest } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { logger } from '@/lib/logger';

/** Same cost factor as signup and the rest of the dashboard auth. */
export const BCRYPT_ROUNDS = 12;
export const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

const usersLogger = logger.child({ service: 'users' });
// Login validates emails with Joi (IANA TLDs); apply the same rule so every
// account created here can actually sign in.
const emailSchema = Joi.string().email().max(254);

/**
 * Generates a one-time password (UUID v4) and its bcrypt hash. The plaintext is
 * returned to the caller exactly once and must never be logged or stored.
 */
export async function generatePassword(): Promise<{ password: string; passwordHash: string }> {
  const password = crypto.randomUUID();
  return { password, passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS) };
}

export const userSelect = {
  id: true, email: true, firstName: true, lastName: true, role: true, isActive: true,
  lastLoginAt: true, createdAt: true, uiLanguage: true,
  createdBy: { select: { firstName: true, lastName: true } },
} satisfies Prisma.AdminSelect;

export type UserErrors = Partial<Record<'firstName' | 'lastName' | 'email' | 'role' | 'uiLanguage', string>>;

export function cleanName(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
}

export function validateName(value: string): string | null {
  if (!value) return 'required';
  if (value.length > 60) return 'too_long';
  return null;
}

export function normalizeEmail(value: unknown): string {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

export function validateEmail(value: string): string | null {
  if (!value) return 'required';
  return emailSchema.validate(value).error ? 'invalid_email' : null;
}

/**
 * Serializes changes to a company's super admins so two concurrent requests
 * cannot both demote/deactivate "the other" super admin.
 */
export async function lockCompanyAccounts(tx: Prisma.TransactionClient, companyId: string) {
  await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtext(${`admins:${companyId}`}))`;
}

export async function activeSuperAdminCount(tx: Prisma.TransactionClient, companyId: string, excludeId?: string) {
  return tx.admin.count({ where: { companyId, role: 'SUPER_ADMIN', isActive: true, ...(excludeId ? { id: { not: excludeId } } : {}) } });
}

/** Signs a user out everywhere (refresh tokens); access tokens are rechecked per request. */
/**
 * Sign an account out everywhere: revoke its refresh tokens and bump tokenVersion so
 * every access token already issued fails authMiddleware on its next request.
 */
export async function revokeSessions(tx: Prisma.TransactionClient, adminId: string) {
  await tx.refreshToken.updateMany({ where: { adminId, isRevoked: false }, data: { isRevoked: true } });
  await tx.admin.update({ where: { id: adminId }, data: { tokenVersion: { increment: 1 } } });
}

/** Best-effort audit trail. Never include passwords or hashes in values. */
export async function audit(request: NextRequest, actorId: string, action: string, resourceId: string, oldValues?: object, newValues?: object) {
  try {
    await prisma.auditLog.create({
      data: {
        action, resource: 'admin', resourceId, adminId: actorId,
        oldValues: oldValues as Prisma.InputJsonValue | undefined,
        newValues: newValues as Prisma.InputJsonValue | undefined,
        ipAddress: request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || request.headers.get('x-real-ip') || null,
        userAgent: request.headers.get('user-agent')?.slice(0, 300) || null,
      },
    });
  } catch (error) {
    usersLogger.warn('Failed to write audit log', { action, resourceId, error: error instanceof Error ? error.message : String(error) });
  }
}
