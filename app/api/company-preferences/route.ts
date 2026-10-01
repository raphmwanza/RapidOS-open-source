import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';
import { normalizeLocale } from '@/lib/i18n';
import { isBehaviorToggleKey, type BehaviorToggles } from '@/lib/company/catalog';
import {
  applyBotLanguage,
  applyCoverage,
  CoverageRequiredError,
  loadCompanyPreferences,
  saveBehaviorToggles,
} from '@/lib/company/preferences';

const roles = ['ADMIN', 'SUPER_ADMIN'];

/** Company language, behaviour toggles and coverage (claim types). */
export async function GET(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: roles });
  if (error) return error;
  const admin = (request as any).admin;
  return NextResponse.json(await loadCompanyPreferences(admin.companyId));
}

/**
 * PUT { uiLanguage?, botLanguage?, toggles?: {key: boolean}, coverage?: {TYPE: boolean} }
 * Everything is applied in one transaction.
 */
export async function PUT(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: roles });
  if (error) return error;
  const admin = (request as any).admin;
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid body' }, { status: 400 });

  const uiLanguage = body.uiLanguage === undefined ? undefined : normalizeLocale(body.uiLanguage);
  const botLanguage = body.botLanguage === undefined ? undefined : normalizeLocale(body.botLanguage);
  if (uiLanguage === null || botLanguage === null) {
    return NextResponse.json({ error: 'Language must be "en" or "fr"' }, { status: 400 });
  }

  const toggles: Partial<BehaviorToggles> = {};
  if (body.toggles !== undefined) {
    if (typeof body.toggles !== 'object' || body.toggles === null) return NextResponse.json({ error: 'Invalid toggles' }, { status: 400 });
    for (const [key, value] of Object.entries(body.toggles)) {
      if (!isBehaviorToggleKey(key) || typeof value !== 'boolean') return NextResponse.json({ error: `Invalid toggle ${key}` }, { status: 400 });
      toggles[key] = value;
    }
  }

  let coverage: Record<string, boolean> | undefined;
  if (body.coverage !== undefined) {
    if (typeof body.coverage !== 'object' || body.coverage === null) return NextResponse.json({ error: 'Invalid coverage' }, { status: 400 });
    coverage = {};
    for (const [type, value] of Object.entries(body.coverage)) {
      if (!/^[A-Z_]{2,50}$/.test(type) || typeof value !== 'boolean') return NextResponse.json({ error: `Invalid coverage ${type}` }, { status: 400 });
      coverage[type] = value;
    }
  }

  try {
    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      if (uiLanguage) await tx.company.update({ where: { id: admin.companyId }, data: { uiLanguage } });
      if (botLanguage) await applyBotLanguage(tx, admin.companyId, botLanguage);
      const company = await tx.company.findUnique({ where: { id: admin.companyId }, select: { botLanguage: true } });
      const seedLocale = normalizeLocale(company?.botLanguage) || 'fr';
      if (Object.keys(toggles).length) await saveBehaviorToggles(tx, admin.companyId, toggles, seedLocale, admin.id);
      if (coverage && Object.keys(coverage).length) await applyCoverage(tx, admin.companyId, coverage, seedLocale);
    }, { timeout: 20000 });
  } catch (err) {
    if (err instanceof CoverageRequiredError) return NextResponse.json({ error: 'coverage_required' }, { status: 400 });
    console.error('Company preferences update failed:', err instanceof Error ? err.message : 'unknown');
    return NextResponse.json({ error: 'Unable to save preferences' }, { status: 500 });
  }

  return NextResponse.json(await loadCompanyPreferences(admin.companyId));
}
