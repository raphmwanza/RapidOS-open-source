'use client';

import { createContext, useContext } from 'react';
import { ADMIN_ROLES, MODERATION_ROLES, READ_ONLY_ROLES, isUserRole, type UserRole } from '@/lib/users/roles';

export interface CurrentUser {
  /** Upper-case role, or '' until the profile has loaded. */
  role: UserRole | '';
  loaded: boolean;
  /** May create/edit/delete ordinary records (everyone except VIEWER). */
  canWrite: boolean;
  /** May archive conversations and delete customers. */
  canModerate: boolean;
  /** May open Settings and Users. */
  isAdmin: boolean;
}

/**
 * Role flags for hiding UI. Everything is false until the role is known, so a viewer
 * never sees write buttons flash. The server enforces the same rules regardless.
 */
export function currentUserFromRole(rawRole: string | null | undefined): CurrentUser {
  const upper = (rawRole || '').toUpperCase();
  const role: UserRole | '' = isUserRole(upper) ? upper : '';
  return {
    role,
    loaded: role !== '',
    canWrite: role !== '' && !READ_ONLY_ROLES.includes(role),
    canModerate: role !== '' && MODERATION_ROLES.includes(role),
    isAdmin: role !== '' && ADMIN_ROLES.includes(role),
  };
}

export const CurrentUserContext = createContext<CurrentUser>(currentUserFromRole(''));

export function useCurrentUser(): CurrentUser {
  return useContext(CurrentUserContext);
}
