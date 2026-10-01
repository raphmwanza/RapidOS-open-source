/**
 * Server-side helpers for the company preferences shown in Settings:
 * dashboard/bot language, behaviour toggles and coverage (claim types).
 */
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { normalizeLocale, type Locale } from '@/lib/i18n';
import {
  BEHAVIOR_TOGGLES,
  COVERAGE_CATALOG,
  contentLocale,
  coverageDefinition,
  defaultBehaviorToggles,
  isBehaviorToggleKey,
  type BehaviorToggles,
  type CoverageType,
} from './catalog';
import { createCoverage, saveBehaviorToggles } from './seed';
import { defaultSystemPrompt, defaultWelcomeMessage, primaryLanguageValue } from './prompts';

type Tx = Prisma.TransactionClient;

export interface CoverageState {
  type: string;
  displayName: string;
  isActive: boolean;
  /** Present in the built-in catalogue (can be re-seeded / added). */
  inCatalog: boolean;
  /** Claim type row exists for this company. */
  configured: boolean;
  fieldCount: number;
}

export interface CompanyPreferences {
  uiLanguage: Locale;
  botLanguage: Locale;
  toggles: BehaviorToggles;
  coverage: CoverageState[];
}

export async function loadCompanyPreferences(companyId: string, db: Tx | typeof prisma = prisma): Promise<CompanyPreferences> {
  const company = await db.company.findUnique({ where: { id: companyId }, select: { uiLanguage: true, botLanguage: true } });
  const botLanguage = normalizeLocale(company?.botLanguage) || 'fr';
  const uiLanguage = normalizeLocale(company?.uiLanguage) || botLanguage;

  const toggles = defaultBehaviorToggles();
  const rows: Array<{ name: string; boolValue: boolean | null; isActive: boolean }> = await db.setting.findMany({
    where: { companyId, type: 'BOOLEAN', name: { in: BEHAVIOR_TOGGLES.map((t) => t.key) } },
    select: { name: true, boolValue: true, isActive: true },
  });
  for (const row of rows) {
    if (isBehaviorToggleKey(row.name) && row.isActive && typeof row.boolValue === 'boolean') toggles[row.name] = row.boolValue;
  }

  const claimTypes: Array<{ typeName: string; displayName: string; isActive: boolean; _count: { fields: number } }> = await db.claimType.findMany({
    where: { companyId },
    orderBy: { sortOrder: 'asc' },
    select: { typeName: true, displayName: true, isActive: true, _count: { select: { fields: true } } },
  });
  const coverage: CoverageState[] = claimTypes.map((ct) => ({
    type: ct.typeName,
    displayName: ct.displayName,
    isActive: ct.isActive,
    inCatalog: !!coverageDefinition(ct.typeName),
    configured: true,
    fieldCount: ct._count.fields,
  }));
  for (const def of COVERAGE_CATALOG) {
    if (coverage.some((c) => c.type === def.type)) continue;
    coverage.push({ type: def.type, displayName: def.label[contentLocale(uiLanguage)], isActive: false, inCatalog: true, configured: false, fieldCount: 0 });
  }

  return { uiLanguage, botLanguage, toggles, coverage };
}

/**
 * Switches the bot language. The seeded welcome message / system prompt are
 * swapped for the other language's default only if the admin never edited them.
 */
export async function applyBotLanguage(tx: Tx, companyId: string, next: Locale) {
  const company = await tx.company.findUnique({
    where: { id: companyId },
    select: { name: true, botLanguage: true, chatbotConfig: { select: { id: true, systemPrompt: true, welcomeMessage: true } } },
  });
  if (!company) return;
  const previous = normalizeLocale(company.botLanguage);
  await tx.company.update({ where: { id: companyId }, data: { botLanguage: next } });
  const cfg = company.chatbotConfig;
  if (!cfg || !previous || previous === next) return;

  const data: Prisma.ChatbotConfigUpdateInput = {};
  if (cfg.systemPrompt === defaultSystemPrompt(previous, company.name)) {
    data.systemPrompt = defaultSystemPrompt(next, company.name);
    data.system_prompt = data.systemPrompt;
  }
  if (cfg.welcomeMessage === await defaultWelcomeMessage(previous, company.name)) {
    data.welcomeMessage = await defaultWelcomeMessage(next, company.name);
    data.welcome_message = data.welcomeMessage;
  }
  if (Object.keys(data).length) await tx.chatbotConfig.update({ where: { id: cfg.id }, data });

  await tx.setting.updateMany({
    where: { companyId, name: 'primary_language', type: 'TEXT' },
    data: { textValue: primaryLanguageValue(next) },
  });
}

/** Activates/deactivates claim types; enabling a catalogue type that was never set up seeds it. */
export async function applyCoverage(tx: Tx, companyId: string, wanted: Record<string, boolean>, locale: Locale) {
  const existing = await tx.claimType.findMany({ where: { companyId }, select: { id: true, typeName: true, isActive: true, sortOrder: true } });
  const toSeed: CoverageType[] = [];
  for (const [type, active] of Object.entries(wanted)) {
    const row = existing.find((ct) => ct.typeName === type);
    if (row) {
      if (row.isActive !== active) await tx.claimType.update({ where: { id: row.id }, data: { isActive: active } });
    } else if (active && coverageDefinition(type)) {
      toSeed.push(type as CoverageType);
    }
  }
  if (toSeed.length) {
    const nextSort = existing.reduce((max, ct) => Math.max(max, ct.sortOrder), 0) + 1;
    await createCoverage(tx, companyId, toSeed, locale, nextSort);
  }
  const active = await tx.claimType.findMany({ where: { companyId, isActive: true }, orderBy: { sortOrder: 'asc' }, select: { displayName: true } });
  if (active.length === 0) throw new CoverageRequiredError();
  await tx.setting.updateMany({
    where: { companyId, name: 'policy_types', type: 'TEXT' },
    data: { textValue: active.map((ct) => ct.displayName).join(', ') },
  });
}

export class CoverageRequiredError extends Error {
  constructor() {
    super('At least one coverage type must stay active');
  }
}

export { saveBehaviorToggles };

/** Reads one behaviour toggle for a company (missing row → catalogue default). */
export async function isToggleEnabled(companyId: string, key: keyof BehaviorToggles): Promise<boolean> {
  const row = await prisma.setting.findFirst({
    where: { companyId, name: key, type: 'BOOLEAN', isActive: true },
    select: { boolValue: true },
  });
  if (row && typeof row.boolValue === 'boolean') return row.boolValue;
  return defaultBehaviorToggles()[key];
}
