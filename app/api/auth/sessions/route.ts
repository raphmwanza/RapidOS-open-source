import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, securityHeadersMiddleware, getAdminFromRequest } from '@/lib/middleware';
import { logger } from '@/lib/logger';

const sessionsLogger = logger.child({ service: 'auth-sessions' });

/**
 * Revoke All Sessions API
 * Revokes all refresh tokens for the current user
 * Useful after password change or security concern
 */
export async function POST(request: NextRequest) {
  // Authenticate
  const authResult = await authMiddleware(request, { allowReadOnly: true });
  if (authResult) return authResult;

  try {
    const admin = getAdminFromRequest(request);
    if (!admin) {
      return NextResponse.json(
        { error: 'Admin not found in request' },
        { status: 401 }
      );
    }

    // Revoke all refresh tokens and invalidate every issued access token (tokenVersion).
    const [result] = await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: {
          adminId: admin.id,
          isRevoked: false
        },
        data: { isRevoked: true }
      }),
      prisma.admin.update({ where: { id: admin.id }, data: { tokenVersion: { increment: 1 } } })
    ]);

    sessionsLogger.info('All sessions revoked', { userId: admin.id, sessionsRevoked: result.count });

    const response = NextResponse.json({
      message: 'All sessions have been revoked',
      sessionsRevoked: result.count
    }, { status: 200 });

    // Also clear the cookie for current session
    response.cookies.set('refreshToken', '', {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      path: '/',
      maxAge: 0
    });

    return securityHeadersMiddleware(response);

  } catch (error) {
    sessionsLogger.error('Failed to revoke sessions', error);
    return NextResponse.json(
      { error: 'Failed to revoke sessions' },
      { status: 500 }
    );
  }
}

/**
 * GET - List active sessions for current user
 */
export async function GET(request: NextRequest) {
  // Authenticate
  const authResult = await authMiddleware(request);
  if (authResult) return authResult;

  try {
    const admin = getAdminFromRequest(request);
    if (!admin) {
      return NextResponse.json(
        { error: 'Admin not found in request' },
        { status: 401 }
      );
    }

    const now = new Date();
    const sessions = await prisma.refreshToken.findMany({
      where: {
        adminId: admin.id,
        isRevoked: false,
        expiresAt: { gt: now }
      },
      select: {
        id: true,
        createdAt: true,
        expiresAt: true
      },
      orderBy: { createdAt: 'desc' }
    });

    const response = NextResponse.json({
      activeSessions: sessions.length,
      sessions: sessions.map((s: { id: string; createdAt: Date; expiresAt: Date }) => ({
        id: s.id,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isCurrent: false // Could be enhanced to identify current session
      }))
    }, { status: 200 });

    return securityHeadersMiddleware(response);

  } catch (error) {
    sessionsLogger.error('Failed to list sessions', error);
    return NextResponse.json(
      { error: 'Failed to list sessions' },
      { status: 500 }
    );
  }
}
