// Types for the public API reference shown at /docs/api.
// The entries are written from the actual route code (app/api/**/route.ts and
// backend/internal/router/router.go); keep them in sync when a route changes.

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/** How a request authenticates. See AUTH_SCHEMES for the meaning of each. */
export type AuthScheme =
  | 'none'
  | 'jwt'
  | 'jwt-or-pdf-token'
  | 'jwt-or-internal'
  | 'internal'
  | 'refresh-cookie'
  | 'webhook-signature'
  | 'verify-token';

export interface ApiParam {
  name: string;
  in: 'path' | 'query' | 'header' | 'body' | 'form';
  type: string;
  required?: boolean;
  description: string;
}

export interface ApiError {
  status: number;
  error: string;
  when: string;
}

export interface ApiEndpoint {
  method: HttpMethod;
  /** Path as served, e.g. /api/claims/{claimNumber}/pdf */
  path: string;
  service: 'dashboard' | 'api';
  auth: AuthScheme;
  /** Roles allowed (omit = any active dashboard user; VIEWER is always read-only). */
  roles?: string;
  summary: string;
  description?: string;
  params?: ApiParam[];
  /** Example JSON request body (pretty-printed). */
  body?: string;
  /** multipart/form-data fields used by the curl example. */
  form?: Record<string, string>;
  /** Example success response (JSON) or a short description for binary responses. */
  response?: string;
  successStatus?: number;
  errors?: ApiError[];
  /** Overrides the generated curl example. */
  curl?: string;
}

export interface ApiGroup {
  id: string;
  title: string;
  description: string;
  endpoints: ApiEndpoint[];
}

// Common error rows shared by JWT-protected dashboard routes (lib/middleware.ts authMiddleware).
export const JWT_ERRORS: ApiError[] = [
  { status: 401, error: 'Authentication required', when: 'No Authorization: Bearer header' },
  { status: 401, error: 'Invalid or expired token', when: 'Bad signature or expired access token' },
  { status: 401, error: 'Session revoked - please sign in again', when: 'Password reset, deactivation or "sign out everywhere" (code session_revoked)' },
  { status: 401, error: 'You were signed out because this account signed in on another device', when: 'A newer sign-in of the same account replaced this session (code session_replaced)' },
];
export const ROLE_ERROR: ApiError = { status: 403, error: 'Insufficient role permissions', when: 'Your role is not allowed on this route' };
export const READ_ONLY_ERROR: ApiError = { status: 403, error: 'Insufficient role permissions', when: 'VIEWER accounts cannot call write methods (code read_only_role)' };

export const ADMIN_ONLY = 'SUPER_ADMIN, ADMIN';
export const MODERATION = 'SUPER_ADMIN, ADMIN, MODERATOR';
