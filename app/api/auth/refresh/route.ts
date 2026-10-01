import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, generateTokens, getTokenExpiry } from '@/lib/auth';
import { corsMiddleware, securityHeadersMiddleware, validateInput } from '@/lib/middleware';
import { redisRateLimit } from '@/lib/redis';
import { refreshTokenSchema } from '@/lib/validation';
import { SESSION_REPLACED_CODE, SESSION_REPLACED_MESSAGE, sessionIsCurrent } from '@/lib/sessionPolicy';

/**
 * Build a 401 response that also clears the refreshToken cookie.
 * This prevents the browser from resending a dead/revoked token in a loop.
 */
function failWithClearedCookie(message: string, code?: string) {
  const response = NextResponse.json(
    code ? { error: message, code } : { error: message },
    { status: 401 }
  );
  response.cookies.set('refreshToken', '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: 0, // Expire immediately
  });
  return response;
}

export async function POST(request: NextRequest) {
  // Apply CORS
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  // Rate limit refresh attempts
  const clientIp = request.ip || request.headers.get('x-forwarded-for') || 'unknown';
  const rateLimit = await redisRateLimit(`refresh:${clientIp}`, 60 * 1000, 30); // 30 per minute
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: 'Too many refresh attempts. Please try again later.' },
      { status: 429 }
    );
  }

  try {
    // Get refresh token from cookie or body
    const refreshTokenCookie = request.cookies.get('refreshToken');
    let refreshTokenValue = refreshTokenCookie?.value;

    console.log('Refresh: Cookie present:', !!refreshTokenCookie, 'Token length:', refreshTokenValue?.length);

    if (!refreshTokenValue) {
      try {
        const body = await request.json();
        const validation = validateInput(refreshTokenSchema, body);
        if (!validation.isValid) {
          console.log('Refresh: Body validation failed:', validation.errors);
          return NextResponse.json(
            { error: 'Invalid refresh token' },
            { status: 400 }
          );
        }
        refreshTokenValue = body.refreshToken;
        console.log('Refresh: Using token from body, length:', refreshTokenValue?.length);
      } catch (jsonError) {
        console.log('Refresh: Failed to parse JSON body:', jsonError);
        return NextResponse.json(
          { error: 'Refresh token required' },
          { status: 400 }
        );
      }
    }

    if (!refreshTokenValue) {
      console.log('Refresh: No refresh token found in cookie or body');
      return NextResponse.json(
        { error: 'Refresh token required' },
        { status: 400 }
      );
    }

    console.log('Refresh: Attempting to verify token, length:', refreshTokenValue.length);

    // Verify refresh token JWT signature
    const payload = verifyToken(refreshTokenValue, true);
    if (!payload) {
      console.log('Refresh: Token verification failed');
      return failWithClearedCookie('Invalid or expired refresh token');
    }

    // A newer login replaced this session: its refresh token was revoked on purpose.
    // Answer before the reuse-attack check below, which would revoke the new session too.
    const sessionOwner = await prisma.admin.findUnique({ where: { id: payload.adminId }, select: { currentSessionId: true } });
    if (sessionOwner && !sessionIsCurrent(payload, sessionOwner)) {
      return failWithClearedCookie(SESSION_REPLACED_MESSAGE, SESSION_REPLACED_CODE);
    }

    // Validate refresh token against database (check if revoked)
    const storedToken = await prisma.refreshToken.findUnique({
      where: { token: refreshTokenValue }
    });

    if (!storedToken) {
      console.log('Refresh: Token not found in database - possible token reuse attack');
      // Token not in database - could be a stolen token being reused
      // Revoke ALL tokens for this user as a security measure
      await prisma.refreshToken.updateMany({
        where: { adminId: payload.adminId },
        data: { isRevoked: true }
      });
      return failWithClearedCookie('Invalid refresh token - please login again');
    }

    if (storedToken.isRevoked) {
      console.log('Refresh: Token has been revoked - possible token reuse attack');
      // Revoked token being used - security breach, revoke all tokens
      await prisma.refreshToken.updateMany({
        where: { adminId: payload.adminId },
        data: { isRevoked: true }
      });
      return failWithClearedCookie('Token has been revoked - please login again');
    }

    if (storedToken.expiresAt < new Date()) {
      console.log('Refresh: Token has expired');
      return failWithClearedCookie('Refresh token expired - please login again');
    }

    console.log('Refresh: Database validation passed');

    console.log('Refresh: Token verified successfully for admin:', payload.adminId);

    // Get admin from database to ensure they still exist and are active
    const admin = await prisma.admin.findUnique({
      where: { id: payload.adminId },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            domain: true,
            isActive: true
          }
        }
      }
    });

    if (!admin) {
      console.log('Refresh: Admin not found for ID:', payload.adminId);
      return NextResponse.json(
        { error: 'Account not found' },
        { status: 403 }
      );
    }

    if (!admin.isActive) {
      console.log('Refresh: Admin account is inactive:', admin.email);
      return NextResponse.json(
        { error: 'Account is inactive' },
        { status: 403 }
      );
    }

    // Password reset / deactivation / "sign out everywhere" bumped the version.
    if ((payload.tv ?? 0) !== admin.tokenVersion) {
      await prisma.refreshToken.updateMany({ where: { adminId: admin.id, isRevoked: false }, data: { isRevoked: true } });
      return failWithClearedCookie('Session revoked - please login again');
    }

    if (!admin.company.isActive) {
      console.log('Refresh: Company is inactive:', admin.company.name);
      return NextResponse.json(
        { error: 'Company is inactive' },
        { status: 403 }
      );
    }

    // Generate new tokens
    const newTokenPayload = {
      adminId: admin.id,
      companyId: admin.companyId,
      role: admin.role as string,
      email: admin.email,
      tv: admin.tokenVersion,
      // Same session: refreshing does not start a new one.
      ...(payload.sid ? { sid: payload.sid } : {})
    };

    console.log('Refresh: Generating new tokens for:', newTokenPayload);

    const { accessToken, refreshToken: newRefreshToken } = generateTokens(newTokenPayload);

    console.log('Refresh: New tokens generated:', {
      accessTokenLength: accessToken.length,
      refreshTokenLength: newRefreshToken.length,
      accessTokenStart: accessToken.substring(0, 20) + '...'
    });

    // TOKEN ROTATION: Revoke old token and store new one
    const refreshExpiry = getTokenExpiry('refresh');
    const newExpiresAt = new Date(Date.now() + refreshExpiry * 1000);

    // Use transaction to ensure atomic rotation
    await prisma.$transaction([
      // Revoke the old token and any other refresh token of this account (single session)
      prisma.refreshToken.updateMany({
        where: { adminId: admin.id, isRevoked: false },
        data: { isRevoked: true }
      }),
      // Store the new token
      prisma.refreshToken.create({
        data: {
          token: newRefreshToken,
          adminId: admin.id,
          expiresAt: newExpiresAt,
          isRevoked: false
        }
      })
    ]);

    console.log('Refresh: Token rotated successfully');

    const response = NextResponse.json(
      {
        message: 'Token refreshed successfully',
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          company: admin.company
        },
        accessToken
      },
      { status: 200 }
    );

    // Set new refresh token as httpOnly cookie
    response.cookies.set('refreshToken', newRefreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: refreshExpiry
    });

    console.log('Refresh: Success - new tokens set');
    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Token refresh error:', error);
    return NextResponse.json(
      { error: 'Token refresh failed' },
      { status: 500 }
    );
  }
}
