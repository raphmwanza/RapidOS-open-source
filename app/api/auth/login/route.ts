import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { generateTokens, getTokenExpiry } from '@/lib/auth';
import { corsMiddleware, securityHeadersMiddleware, validateInput } from '@/lib/middleware';
import { redisRateLimit } from '@/lib/redis';
import { getClientIp } from '@/lib/clientIp';
import { clearLoginFailures, getAccountLock, recordLoginFailure } from '@/lib/loginLockout';
import { normalizeEmail } from '@/lib/users/service';
import { adminLoginSchema } from '@/lib/validation';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';

// Helper function to verify password
async function verifyPasswordHelper(password: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(password, hash);
  } catch (error) {
    console.error('Password verification error:', error);
    return false;
  }
}

export async function POST(request: NextRequest) {
  // Apply CORS
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  // Per-IP rate limit. X-Forwarded-For is only honoured when TRUSTED_PROXY is set.
  const clientIp = getClientIp(request);
  const rateLimit = await redisRateLimit(`login:${clientIp}`, 15 * 60 * 1000, 10);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many login attempts. Please try again later.' },
      { status: 429, headers: { 'X-RateLimit-Reset': rateLimit.resetTime.toString() } }
    );
  }

  try {
    const body = await request.json();
    // Emails are matched case-insensitively: stored and looked up lowercased and trimmed.
    if (body && typeof body.email === 'string') body.email = normalizeEmail(body.email);

    // Validate input
    const validation = validateInput(adminLoginSchema, body);
    if (!validation.isValid) {
      return NextResponse.json(
        { error: 'Validation failed', details: validation.errors },
        { status: 400 }
      );
    }

  const { email, password, rememberMe: _rememberMe = false } = body;

    // Per-account lockout after repeated failures, whatever IP they come from.
    const lock = await getAccountLock(email);
    if (lock.locked) {
      return NextResponse.json(
        { error: 'Too many failed sign-in attempts for this account. Please try again later.', code: 'account_locked' },
        { status: 429, headers: { 'Retry-After': String(lock.retryAfterSeconds) } }
      );
    }

    // Find admin with company info
    const admin = await prisma.admin.findUnique({
      where: { email },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            domain: true,
            isActive: true,
            uiLanguage: true
          }
        }
      }
    });

    if (!admin || !admin.isActive) {
      await recordLoginFailure(email);
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    if (!admin.company.isActive) {
      return NextResponse.json(
        { error: 'Company account is inactive' },
        { status: 403 }
      );
    }

    // Verify password
    const isPasswordValid = await verifyPasswordHelper(password, admin.passwordHash);
    if (!isPasswordValid) {
      await recordLoginFailure(email);
      return NextResponse.json(
        { error: 'Invalid credentials' },
        { status: 401 }
      );
    }

    await clearLoginFailures(email);

    // One active session per account: this login gets a new session id, and every
    // token of the previous session stops working (lib/sessionPolicy.ts).
    const sessionId = randomUUID();
    const tokenPayload = {
      adminId: admin.id,
      companyId: admin.companyId,
      role: admin.role as string,
      email: admin.email,
      tv: admin.tokenVersion,
      sid: sessionId
    };
    
    console.log('Generating tokens for:', tokenPayload);
    
    const { accessToken, refreshToken } = generateTokens(tokenPayload);
    
    console.log('Tokens generated:', {
      accessTokenLength: accessToken.length,
      refreshTokenLength: refreshToken.length,
      accessTokenStart: accessToken.substring(0, 20) + '...',
      refreshTokenStart: refreshToken.substring(0, 20) + '...'
    });

    // Calculate refresh token expiry
    const refreshExpiry = getTokenExpiry('refresh');
    const expiresAt = new Date(Date.now() + refreshExpiry * 1000);

    // Single session: revoke every other refresh token, store the new one and make this
    // session the current one (older access tokens are then rejected by the middleware).
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: { adminId: admin.id, isRevoked: false },
        data: { isRevoked: true }
      }),
      prisma.refreshToken.create({
        data: {
          token: refreshToken,
          adminId: admin.id,
          expiresAt: expiresAt,
          isRevoked: false
        }
      }),
      prisma.admin.update({
        where: { id: admin.id },
        data: { lastLoginAt: new Date(), currentSessionId: sessionId }
      })
    ]);

    console.log('Refresh token stored in database, expires:', expiresAt.toISOString());

    const response = NextResponse.json(
      {
        message: 'Login successful',
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          // Personal dashboard language, falling back to the company default.
          uiLanguage: admin.uiLanguage || admin.company.uiLanguage || 'en',
          company: admin.company
        },
        accessToken
      },
      { status: 200 }
    );

    // Set refresh token as httpOnly cookie
    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: refreshExpiry
    });

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Login error:', error);
    return NextResponse.json(
      { error: 'Login failed. Please try again.' },
      { status: 500 }
    );
  }
}
