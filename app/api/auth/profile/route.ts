import { NextRequest, NextResponse } from 'next/server';
import { authMiddleware } from '@/lib/middleware';
import { prisma } from '@/lib/prisma';
import { LOCALES, normalizeLocale } from '@/lib/i18n';

export async function GET(request: NextRequest) {
  try {
    const authResponse = await authMiddleware(request, { requireCompanyAccess: true });
    if (authResponse) return authResponse;
    
    const admin = (request as any).admin;
    
    // Get full admin data including company
    const fullAdmin = await prisma.admin.findUnique({
      where: { id: admin.id },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            slug: true,
            domain: true,
            logoUrl: true,
            primaryColor: true,
            botLanguage: true,
            uiLanguage: true,
            isActive: true
          }
        }
      }
    });

    if (!fullAdmin) {
      return NextResponse.json({ error: 'Admin not found' }, { status: 404 });
    }

    const companyUiLanguage = normalizeLocale(fullAdmin.company.uiLanguage) || 'en';
    const responseData = {
      user: {
        id: fullAdmin.id,
        email: fullAdmin.email,
        firstName: fullAdmin.firstName,
        lastName: fullAdmin.lastName,
        role: fullAdmin.role,
        // Effective dashboard language: personal override, else the company default.
        uiLanguage: normalizeLocale(fullAdmin.uiLanguage) || companyUiLanguage,
        uiLanguageOverride: normalizeLocale(fullAdmin.uiLanguage),
        companyUiLanguage,
        company: fullAdmin.company
      }
    };

    return NextResponse.json(responseData);
  } catch (error) {
    console.error('Profile fetch error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch profile' },
      { status: 500 }
    );
  }
}

/**
 * PATCH { uiLanguage: <registered locale code> | null } — set (or clear, with null) the signed-in
 * user's personal dashboard language. Any role may change their own language.
 */
export async function PATCH(request: NextRequest) {
  try {
    const authResponse = await authMiddleware(request, { requireCompanyAccess: true, allowReadOnly: true });
    if (authResponse) return authResponse;
    const admin = (request as any).admin;

    const body = await request.json().catch(() => null);
    if (!body || !('uiLanguage' in body)) {
      return NextResponse.json({ error: 'uiLanguage is required' }, { status: 400 });
    }
    const requested = body.uiLanguage;
    const uiLanguage = requested === null ? null : normalizeLocale(requested);
    if (requested !== null && !uiLanguage) {
      return NextResponse.json({ error: `uiLanguage must be one of ${LOCALES.join(', ')} or null` }, { status: 400 });
    }

    const updated = await prisma.admin.update({
      where: { id: admin.id },
      data: { uiLanguage },
      select: { uiLanguage: true, company: { select: { uiLanguage: true } } },
    });

    return NextResponse.json({
      uiLanguage: normalizeLocale(updated.uiLanguage) || normalizeLocale(updated.company.uiLanguage) || 'en',
      uiLanguageOverride: normalizeLocale(updated.uiLanguage),
    });
  } catch (error) {
    console.error('Profile language update error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Failed to update language' }, { status: 500 });
  }
}
