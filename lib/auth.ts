import crypto from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';

interface JWTPayload {
  adminId: string;
  companyId: string;
  role: string;
  email: string;
  /** Admin.tokenVersion at issue time; bumped on password reset, deactivation and "sign out everywhere". */
  tv?: number;
  /** Session id of the login that issued the token (lib/sessionPolicy.ts). */
  sid?: string;
  iat?: number;
  exp?: number;
}

// Get JWT secrets from environment
const getJWTSecret = (): string => {
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!secret) {
    throw new Error('JWT_ACCESS_SECRET not found in environment variables');
  }
  return secret;
};

const getRefreshSecret = (): string => {
  const secret = process.env.JWT_REFRESH_SECRET;
  if (!secret) {
    throw new Error('JWT_REFRESH_SECRET not found in environment variables');
  }
  return secret;
};

/**
 * Generate access and refresh tokens
 */
export function generateTokens(payload: Omit<JWTPayload, 'iat' | 'exp'>) {
  const accessSecret = getJWTSecret();
  const refreshSecret = getRefreshSecret();

  // Get expiration values - handle both seconds (numbers) and time strings
  const accessExpiresInRaw = process.env.JWT_EXPIRES_IN || '900';
  const refreshExpiresInRaw = process.env.JWT_REFRESH_EXPIRES_IN || '604800';

  // Convert to numbers if they're pure numbers, otherwise use as time strings for JWT
  let accessExpiresIn: number | string;
  let refreshExpiresIn: number | string;

  // Try to parse as numbers first (seconds)
  const accessAsNumber = parseInt(accessExpiresInRaw);
  const refreshAsNumber = parseInt(refreshExpiresInRaw);

  if (!isNaN(accessAsNumber) && accessExpiresInRaw === accessAsNumber.toString()) {
    accessExpiresIn = accessAsNumber;
  } else {
    accessExpiresIn = accessExpiresInRaw; // Use as time string like "15m"
  }

  if (!isNaN(refreshAsNumber) && refreshExpiresInRaw === refreshAsNumber.toString()) {
    refreshExpiresIn = refreshAsNumber;
  } else {
    refreshExpiresIn = refreshExpiresInRaw; // Use as time string like "168h"
  }

  console.log('Generating tokens with config:', {
    accessExpiresIn,
    refreshExpiresIn,
    accessExpiresInType: typeof accessExpiresIn,
    refreshExpiresInType: typeof refreshExpiresIn,
    currentTime: new Date().toISOString(),
    currentTimestamp: Math.floor(Date.now() / 1000)
  });

  // Generate tokens with numeric expiration (seconds) or time strings
  const accessToken = jwt.sign(payload, accessSecret, {
    expiresIn: accessExpiresIn,
    issuer: 'rapidos-app',
    audience: 'rapidos-client'
  } as SignOptions);

  // A unique jwtid keeps two refresh tokens issued in the same second (e.g. two
  // quick logins) from colliding on the unique refresh_tokens.token column.
  const refreshToken = jwt.sign({ ...payload, type: 'refresh' }, refreshSecret, {
    expiresIn: refreshExpiresIn,
    jwtid: crypto.randomUUID(),
    issuer: 'rapidos-app',
    audience: 'rapidos-client'
  } as SignOptions);

  // Decode tokens to check their expiration
  try {
    const decodedAccess = jwt.decode(accessToken) as any;
    const decodedRefresh = jwt.decode(refreshToken) as any;

    console.log('Generated token details:', {
      access: {
        iat: decodedAccess.iat,
        exp: decodedAccess.exp,
        issuedAt: new Date(decodedAccess.iat * 1000).toISOString(),
        expiresAt: new Date(decodedAccess.exp * 1000).toISOString(),
        durationSeconds: decodedAccess.exp - decodedAccess.iat
      },
      refresh: {
        iat: decodedRefresh.iat,
        exp: decodedRefresh.exp,
        issuedAt: new Date(decodedRefresh.iat * 1000).toISOString(),
        expiresAt: new Date(decodedRefresh.exp * 1000).toISOString(),
        durationSeconds: decodedRefresh.exp - decodedRefresh.iat
      }
    });
  } catch (decodeError) {
    console.error('Failed to decode generated tokens:', decodeError);
  }

  return { accessToken, refreshToken };
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string, isRefreshToken: boolean = false): JWTPayload | null {
  try {
    const secret = isRefreshToken ? getRefreshSecret() : getJWTSecret();

    console.log('Verifying token:', {
      tokenLength: token.length,
      isRefreshToken,
      hasSecret: !!secret,
      tokenStart: token.substring(0, 20) + '...'
    });

    const decoded = jwt.verify(token, secret, {
      issuer: 'rapidos-app',
      audience: 'rapidos-client'
    }) as JWTPayload;

    console.log('Token verification successful:', {
      adminId: decoded.adminId,
      companyId: decoded.companyId,
      role: decoded.role,
      email: decoded.email,
      exp: decoded.exp
    });

    return decoded;
  } catch (error) {
    console.error('Token verification failed:', {
      error: error instanceof Error ? error.message : 'Unknown error',
      isRefreshToken,
      tokenLength: token.length
    });
    return null;
  }
}

/**
 * Extract bearer token from Authorization header
 */
export function extractBearerToken(authHeader: string | null): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }
  return authHeader.substring(7);
}

interface PdfAccessPayload {
  claimNumber: string;
  companyId: string;
  purpose: 'pdf-access';
}

/** Short-lived token for WhatsApp/Meta to fetch PDF URLs without dashboard auth. */
export function generatePdfAccessToken(claimNumber: string, companyId: string): string {
  const secret = getJWTSecret();
  return jwt.sign(
    { claimNumber, companyId, purpose: 'pdf-access' } satisfies PdfAccessPayload,
    secret,
    { expiresIn: '24h' }
  );
}

/** Returns the company the token was issued for when it is a valid PDF token for this claim. */
export function verifyPdfAccessToken(token: string, claimNumber: string): { companyId: string } | null {
  try {
    const decoded = jwt.verify(token, getJWTSecret()) as PdfAccessPayload;
    if (decoded.purpose !== 'pdf-access' || decoded.claimNumber !== claimNumber || !decoded.companyId) return null;
    return { companyId: decoded.companyId };
  } catch {
    return null;
  }
}

/**
 * Get token expiry time in seconds for cookies
 */
export function getTokenExpiry(type: 'access' | 'refresh'): number {
  if (type === 'access') {
    const expiresIn = process.env.JWT_EXPIRES_IN || '900';
    const parsed = parseInt(expiresIn);
    // If it's a pure number, use it, otherwise default to 15 minutes (900 seconds)
    return !isNaN(parsed) && expiresIn === parsed.toString() ? parsed : 900;
  } else {
    const expiresIn = process.env.JWT_REFRESH_EXPIRES_IN || '604800';
    const parsed = parseInt(expiresIn);
    // If it's a pure number, use it, otherwise default to 7 days (604800 seconds)
    return !isNaN(parsed) && expiresIn === parsed.toString() ? parsed : 604800;
  }
}