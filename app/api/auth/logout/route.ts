import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { corsMiddleware, securityHeadersMiddleware } from '@/lib/middleware';
import { randomUUID } from 'crypto';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { sessionIsCurrent } from '@/lib/sessionPolicy';

export async function POST(request: NextRequest) {
  // Apply CORS
  const corsResponse = corsMiddleware(request);
  if (corsResponse) return corsResponse;

  try {
    // Get the refresh token from cookie to revoke it
    const refreshTokenCookie = request.cookies.get('refreshToken');
    const refreshTokenValue = refreshTokenCookie?.value;

    // Get access token to identify user (for revoking all their tokens if needed)
    const authHeader = request.headers.get('Authorization');
    const accessToken = extractBearerToken(authHeader);
    const payload = accessToken ? verifyToken(accessToken) : null;

    if (refreshTokenValue) {
      // Revoke the specific refresh token
      await prisma.refreshToken.updateMany({
        where: { 
          token: refreshTokenValue,
          isRevoked: false
        },
        data: { isRevoked: true }
      });
      console.log('Logout: Refresh token revoked');
    }

    // Signing out the account's current session revokes all its refresh tokens and
    // ends the session id, so its access tokens stop working too. A token of a
    // session already replaced by a newer sign-in must not sign out that newer one.
    if (payload?.adminId) {
      const owner = await prisma.admin.findUnique({ where: { id: payload.adminId }, select: { currentSessionId: true } });
      if (owner && sessionIsCurrent(payload, owner)) {
        await prisma.$transaction([
          prisma.refreshToken.updateMany({
            where: { adminId: payload.adminId, isRevoked: false },
            data: { isRevoked: true }
          }),
          prisma.admin.update({ where: { id: payload.adminId }, data: { currentSessionId: randomUUID() } })
        ]);
        console.log('Logout: session ended for admin:', payload.adminId);
      }
    }

    const response = NextResponse.json(
      { message: 'Logout successful' },
      { status: 200 }
    );

    // Clear refresh token cookie
    response.cookies.set('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    });

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Logout error:', error);
    // Even if database operation fails, clear the cookie
    const response = NextResponse.json(
      { message: 'Logout completed' },
      { status: 200 }
    );

    response.cookies.set('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    });

    return securityHeadersMiddleware(response);
  }
}
