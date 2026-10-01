import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { authMiddleware, securityHeadersMiddleware } from '@/lib/middleware';
import { logger } from '@/lib/logger';

const tokenLogger = logger.child({ service: 'token-cleanup' });

/**
 * Token Cleanup API
 * Removes expired and revoked refresh tokens from the database
 * Should be called periodically (e.g., daily via cron job)
 * Only accessible by SUPER_ADMIN role
 */
export async function POST(request: NextRequest) {
  // Authenticate and authorize
  const authResult = await authMiddleware(request, { requiredRole: ['SUPER_ADMIN'] });
  if (authResult) return authResult;

  try {
    const now = new Date();

    // Delete all expired tokens (older than their expiry date)
    const expiredResult = await prisma.refreshToken.deleteMany({
      where: {
        expiresAt: { lt: now }
      }
    });

    // Delete all revoked tokens older than 24 hours
    // (keeping recent revoked tokens helps detect token reuse attacks)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const revokedResult = await prisma.refreshToken.deleteMany({
      where: {
        isRevoked: true,
        createdAt: { lt: oneDayAgo }
      }
    });

    tokenLogger.info('Token cleanup completed', {
      expiredTokensDeleted: expiredResult.count,
      revokedTokensDeleted: revokedResult.count
    });

    const response = NextResponse.json({
      message: 'Token cleanup completed',
      expiredTokensDeleted: expiredResult.count,
      revokedTokensDeleted: revokedResult.count
    }, { status: 200 });

    return securityHeadersMiddleware(response);

  } catch (error) {
    tokenLogger.error('Token cleanup failed', error);
    return NextResponse.json(
      { error: 'Token cleanup failed' },
      { status: 500 }
    );
  }
}

/**
 * GET - Get token statistics
 */
export async function GET(request: NextRequest) {
  // Authenticate and authorize
  const authResult = await authMiddleware(request, { requiredRole: ['SUPER_ADMIN'] });
  if (authResult) return authResult;

  try {
    const now = new Date();

    const [total, active, expired, revoked] = await Promise.all([
      prisma.refreshToken.count(),
      prisma.refreshToken.count({
        where: {
          isRevoked: false,
          expiresAt: { gt: now }
        }
      }),
      prisma.refreshToken.count({
        where: { expiresAt: { lt: now } }
      }),
      prisma.refreshToken.count({
        where: { isRevoked: true }
      })
    ]);

    const response = NextResponse.json({
      total,
      active,
      expired,
      revoked
    }, { status: 200 });

    return securityHeadersMiddleware(response);

  } catch (error) {
    tokenLogger.error('Failed to get token statistics', error);
    return NextResponse.json(
      { error: 'Failed to get token statistics' },
      { status: 500 }
    );
  }
}
