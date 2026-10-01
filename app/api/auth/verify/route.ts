import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { verifyToken, extractBearerToken } from '@/lib/auth';
import { securityHeadersMiddleware, tokenVersionMatches } from '@/lib/middleware';
import { sessionIsCurrent, sessionReplacedBody } from '@/lib/sessionPolicy';

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get('Authorization');
    const token = extractBearerToken(authHeader);
    
    if (!token) {
      return NextResponse.json(
        { error: 'No token provided' },
        { status: 401 }
      );
    }

    const payload = verifyToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Invalid or expired token' },
        { status: 401 }
      );
    }

    // Verify admin exists and is active
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

    if (!admin || !admin.isActive) {
      return NextResponse.json(
        { error: 'Admin not found or inactive' },
        { status: 401 }
      );
    }

    if (!tokenVersionMatches(payload, admin)) {
      return NextResponse.json(
        { error: 'Session revoked - please sign in again', code: 'session_revoked' },
        { status: 401 }
      );
    }

    if (!sessionIsCurrent(payload, admin)) {
      return NextResponse.json(sessionReplacedBody, { status: 401 });
    }

    if (!admin.company.isActive) {
      return NextResponse.json(
        { error: 'Company account is inactive' },
        { status: 403 }
      );
    }

    const response = NextResponse.json(
      {
        valid: true,
        admin: {
          id: admin.id,
          email: admin.email,
          firstName: admin.firstName,
          lastName: admin.lastName,
          role: admin.role,
          company: admin.company
        }
      },
      { status: 200 }
    );

    return securityHeadersMiddleware(response);

  } catch (error) {
    console.error('Token verification error:', error);
    return NextResponse.json(
      { error: 'Token verification failed' },
      { status: 500 }
    );
  }
}
