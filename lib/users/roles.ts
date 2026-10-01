// Dashboard roles and what each may do. Roles are enforced server-side in
// lib/middleware.ts (read-only roles) and per route via `requiredRole`.
//
//   SUPER_ADMIN  everything, including managing other super admins
//   ADMIN        company settings, integrations and users (except super admins)
//   MODERATOR    agent work + moderation: archive conversations, delete customers
//   AGENT        day-to-day work: conversations, customers, claims, documents
//   VIEWER       read-only access to conversations, customers, claims, analytics

export const USER_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR', 'AGENT', 'VIEWER'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** May open Settings and Users, change integrations and company preferences. */
export const ADMIN_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN'];
/** May archive conversations and delete customers. */
export const MODERATION_ROLES: readonly UserRole[] = ['SUPER_ADMIN', 'ADMIN', 'MODERATOR'];
/** Blocked from every non-GET API request (see authMiddleware). */
export const READ_ONLY_ROLES: readonly UserRole[] = ['VIEWER'];

export function isUserRole(value: unknown): value is UserRole {
  return typeof value === 'string' && (USER_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: unknown): boolean {
  return typeof role === 'string' && (ADMIN_ROLES as readonly string[]).includes(role);
}

/** Roles an actor may grant. Only a super admin can create or promote super admins. */
export function assignableRoles(actorRole: string | null | undefined): UserRole[] {
  if (actorRole === 'SUPER_ADMIN') return [...USER_ROLES];
  if (actorRole === 'ADMIN') return ['ADMIN', 'MODERATOR', 'AGENT', 'VIEWER'];
  return [];
}

/** Whether an actor may edit, deactivate or reset the password of a target account. */
export function canManageAccount(actorRole: string | null | undefined, targetRole: string | null | undefined): boolean {
  if (actorRole === 'SUPER_ADMIN') return true;
  if (actorRole === 'ADMIN') return targetRole !== 'SUPER_ADMIN';
  return false;
}

