import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { verifyToken, extractBearerToken, verifyPdfAccessToken } from './auth';
import { prisma } from './prisma';
import { logger, generateCorrelationId, setCorrelationId } from './logger';
import { READ_ONLY_ROLES } from './users/roles';
import { sessionIsCurrent, sessionReplacedBody } from './sessionPolicy';

const authLogger = logger.child({ service: 'auth-middleware' });

export interface AuthMiddlewareOptions {
  requiredRole?: string[];
  requireCompanyAccess?: boolean;
  /** Let read-only roles (VIEWER) call a mutating method, e.g. to change their own language. */
  allowReadOnly?: boolean;
}

// Generate and attach correlation ID to request
export function attachCorrelationId(request: NextRequest): string {
  const existingId = request.headers.get('x-correlation-id');
  const correlationId = existingId || generateCorrelationId();
  setCorrelationId(correlationId);
  return correlationId;
}

/** A token is only valid while its `tv` claim matches the account's current tokenVersion. */
export function tokenVersionMatches(payload: { tv?: number }, admin: { tokenVersion: number }): boolean {
  return (payload.tv ?? 0) === admin.tokenVersion;
}

/**
 * Verify an access token and load its admin: signature, expiry, account active and
 * token version (so a password reset or deactivation invalidates tokens immediately).
 * Used by authMiddleware and by the few routes that read the token from elsewhere.
 */
export async function authenticateAccessToken(token: string | null | undefined) {
  if (!token) {
    return { error: NextResponse.json({ error: 'Authentication required' }, { status: 401 }) } as const;
  }
  const payload = verifyToken(token);
  if (!payload) {
    return { error: NextResponse.json({ error: 'Invalid or expired token' }, { status: 401 }) } as const;
  }
  const admin = await prisma.admin.findUnique({
    where: { id: payload.adminId },
    include: { company: true }
  });
  if (!admin || !admin.isActive) {
    return { error: NextResponse.json({ error: 'Admin not found or inactive' }, { status: 401 }) } as const;
  }
  if (!tokenVersionMatches(payload, admin)) {
    return {
      error: NextResponse.json({ error: 'Session revoked - please sign in again', code: 'session_revoked' }, { status: 401 })
    } as const;
  }
  if (!sessionIsCurrent(payload, admin)) {
    return { error: NextResponse.json(sessionReplacedBody, { status: 401 }) } as const;
  }
  return { admin, payload } as const;
}

// Authentication middleware
export async function authMiddleware(
  request: NextRequest,
  options: AuthMiddlewareOptions = {}
): Promise<NextResponse | null> {
  const correlationId = attachCorrelationId(request);

  try {
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);

    authLogger.debug('Processing authentication', {
      correlationId,
      path: request.nextUrl.pathname,
      hasAuthHeader: !!authHeader,
      hasToken: !!token
    });

    if (!token) {
      authLogger.debug('No token provided', { correlationId, path: request.nextUrl.pathname });
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      authLogger.debug('Token verification failed', { correlationId });
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    authLogger.debug('Token verified, checking admin', { correlationId, adminId: payload.adminId });

    // Verify admin exists and is active
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      include: { company: true }
    });

    if (!admin || !admin.isActive) {
      authLogger.debug('Admin not found or inactive', {
        correlationId,
        adminFound: !!admin,
        isActive: admin?.isActive
      });
      return NextResponse.json(
        { error: 'Admin not found or inactive' },
        { status: 401 }
      );
    }

    // Password reset, deactivation and "sign out everywhere" bump tokenVersion.
    if (!tokenVersionMatches(payload, admin)) {
      authLogger.debug('Token version mismatch (session revoked)', { correlationId, adminId: admin.id });
      return NextResponse.json(
        { error: 'Session revoked - please sign in again', code: 'session_revoked' },
        { status: 401 }
      );
    }

    // Only the latest login of an account is valid (lib/sessionPolicy.ts).
    if (!sessionIsCurrent(payload, admin)) {
      authLogger.debug('Session replaced by a newer login', { correlationId, adminId: admin.id });
      return NextResponse.json(sessionReplacedBody, { status: 401 });
    }

    authLogger.debug('Admin verified', {
      correlationId,
      adminId: admin.id,
      email: admin.email,
      companyId: admin.companyId
    });

    // Check company access
    if (options.requireCompanyAccess && admin.companyId !== payload.companyId) {
      authLogger.warn('Company access denied', {
        correlationId,
        adminCompanyId: admin.companyId,
        tokenCompanyId: payload.companyId
      });
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    // Check role requirements
    if (options.requiredRole && !options.requiredRole.includes(admin.role)) {
      authLogger.warn('Role access denied', {
        correlationId,
        adminRole: admin.role,
        requiredRoles: options.requiredRole
      });
      return NextResponse.json(
        { error: 'Insufficient role permissions' },
        { status: 403 }
      );
    }

    // Read-only roles may look but never change data.
    const method = request.method.toUpperCase();
    if (!options.allowReadOnly && !['GET', 'HEAD', 'OPTIONS'].includes(method) && (READ_ONLY_ROLES as readonly string[]).includes(admin.role || '')) {
      authLogger.warn('Read-only role attempted a write', { correlationId, adminRole: admin.role, method });
      return NextResponse.json(
        { error: 'Insufficient role permissions', code: 'read_only_role' },
        { status: 403 }
      );
    }

    // Add admin info to request
    (request as any).admin = {
      id: admin.id,
      companyId: admin.companyId,
      role: admin.role,
      email: admin.email
    };

    authLogger.debug('Authentication successful', { correlationId, email: admin.email });
    return null; // No error, continue
  } catch (error) {
    authLogger.error('Authentication failed', error, { correlationId });
    return NextResponse.json(
      { error: 'Authentication failed' },
      { status: 500 }
    );
  }
}

// Rate limiting middleware using in-memory store (for production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

export function rateLimitMiddleware(
  identifier: string,
  windowMs: number = 15 * 60 * 1000, // 15 minutes
  maxRequests: number = 100
): boolean {
  const now = Date.now();
  const key = identifier;

  const current = rateLimitStore.get(key);

  if (!current || now > current.resetTime) {
    rateLimitStore.set(key, {
      count: 1,
      resetTime: now + windowMs
    });
    return true;
  }

  if (current.count >= maxRequests) {
    return false;
  }

  current.count++;
  return true;
}

// Input validation middleware
export function validateInput(schema: any, data: any): { isValid: boolean; errors?: any } {
  try {
    const { error } = schema.validate(data, { abortEarly: false });
    if (error) {
      return {
        isValid: false,
        errors: error.details.map((detail: any) => ({
          field: detail.path.join('.'),
          message: detail.message
        }))
      };
    }
    return { isValid: true };
  } catch (error) {
    return {
      isValid: false,
      errors: [{ field: 'general', message: 'Validation failed' }]
    };
  }
}

// CORS middleware for API routes
export function corsMiddleware(request: NextRequest): NextResponse | null {
  const origin = request.headers.get('origin');
  const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    process.env.NEXT_PUBLIC_APP_URL,
    process.env.NEXT_PUBLIC_BASE_URL
  ].filter(Boolean);

  if (origin && !allowedOrigins.includes(origin)) {
    authLogger.warn('CORS blocked', { origin, allowedOrigins });
    return NextResponse.json(
      { error: 'CORS not allowed' },
      { status: 403 }
    );
  }

  return null;
}

// Security headers middleware
export function securityHeadersMiddleware(response: NextResponse, correlationId?: string): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  // Allow iframes within same origin for inline previews (images/PDFs)
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

  // Add correlation ID to response for tracing
  if (correlationId) {
    response.headers.set('X-Correlation-ID', correlationId);
  }

  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }

  return response;
}

// Helper to get admin from request (set by authMiddleware)
export function getAdminFromRequest(request: NextRequest): { id: string; companyId: string; role: string; email: string } | null {
  const admin = (request as any).admin;
  return admin || null;
}

function getConfiguredInternalApiKey(): string | undefined {
  return process.env.INTERNAL_API_KEY || process.env.BACKEND_API_KEY;
}

function getProvidedInternalApiKey(request: NextRequest): string | null {
  const headerKey =
    request.headers.get('x-internal-api-key') ||
    request.headers.get('x-api-key');
  if (headerKey) return headerKey;
  return extractBearerToken(request.headers.get('Authorization'));
}

export function isValidInternalApiKey(request: NextRequest): boolean {
  const expected = getConfiguredInternalApiKey();
  const provided = getProvidedInternalApiKey(request);
  if (!expected || !provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Dashboard JWT auth, or a signed PDF access token (for WhatsApp document links). */
export async function authOrPdfAccessMiddleware(
  request: NextRequest,
  claimNumber: string,
  options: AuthMiddlewareOptions = {}
): Promise<NextResponse | null> {
  const accessToken = request.nextUrl.searchParams.get('accessToken');
  if (accessToken && verifyPdfAccessToken(accessToken, claimNumber)) {
    return null;
  }
  return authMiddleware(request, options);
}

/** Accept JWT (dashboard) or internal API key (Go backend service calls). */
export async function authOrInternalKeyMiddleware(
  request: NextRequest,
  options: AuthMiddlewareOptions = {}
): Promise<NextResponse | null> {
  if (isValidInternalApiKey(request)) {
    return null;
  }
  return authMiddleware(request, options);
}

/** Headers for authenticated calls from Next.js to the Go backend internal API. */
export function getBackendInternalHeaders(companyId?: string): Record<string, string> {
  const apiKey = getConfiguredInternalApiKey();
  if (!apiKey) {
    throw new Error('INTERNAL_API_KEY or BACKEND_API_KEY is not configured');
  }
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Internal-API-Key': apiKey,
  };
  if (companyId) {
    headers['X-Company-ID'] = companyId;
  }
  return headers;
}

// Company context middleware
export async function companyContextMiddleware(
  _request: NextRequest,
  companyId: string
): Promise<{ company: any } | NextResponse> {
  try {
    const company = await prisma.company.findUnique({
      where: { id: companyId, isActive: true },
      include: {
        chatbotConfig: true
      }
    });

    if (!company) {
      return NextResponse.json(
        { error: 'Company not found or inactive' },
        { status: 404 }
      );
    }

    return { company };
  } catch (error) {
    authLogger.error('Company context error', error, { companyId });
    return NextResponse.json(
      { error: 'Failed to load company context' },
      { status: 500 }
    );
  }
}
