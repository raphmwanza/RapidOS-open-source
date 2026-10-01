/**
 * Tenant seeding helpers. All functions take a Prisma transaction client so
 * the signup flow can create a company and its data atomically.
 */
import type { Prisma } from '@prisma/client';
import { loadMessages, translate, type Locale, type TranslationKey } from '@/lib/i18n';
import { primaryLanguageValue } from './prompts';
import {
  BEHAVIOR_TOGGLES,
  contentLocale,
  coverageDefinition,
  type BehaviorToggleKey,
  type BehaviorToggles,
  type CoverageType,
} from './catalog';

type Tx = Prisma.TransactionClient;

const PHOTO_RULES = { accept: ['image/jpeg', 'image/png', 'image/webp'], maxFiles: 10, maxSize: '5MB' };
const DOCUMENT_RULES = { accept: ['application/pdf', 'image/jpeg', 'image/png', 'image/webp'], maxFiles: 5, maxSize: '10MB' };

/** Claim field rows (information + documents) for one coverage type. */
export function claimFieldRows(type: CoverageType, locale: Locale) {
  const c = contentLocale(locale);
  const def = coverageDefinition(type);
  if (!def) throw new Error(`Unknown coverage type ${type}`);
  const info = def.fields.map((field, index) => ({
    fieldName: field.fieldName,
    displayName: field.label[c],
    fieldType: field.fieldType,
    isRequired: field.isRequired,
    extractionPrompt: field.extractionPrompt?.[c],
    sortOrder: index + 1,
  }));
  const docs = def.documents.map((doc, index) => ({
    fieldName: doc.fieldName,
    displayName: doc.label[c],
    fieldType: doc.kind === 'photos' ? 'array' : 'document',
    isRequired: doc.isRequired,
    helpText: doc.help[c],
    validationRules: doc.kind === 'photos' ? PHOTO_RULES : DOCUMENT_RULES,
    sortOrder: info.length + index + 1,
  }));
  return [...info, ...docs];
}

/**
 * Claim type name in the company language (`catalog.coverage.*` dictionary
 * keys, English fallback). Call after `loadMessages(locale)`.
 */
export function coverageLabel(type: CoverageType, locale: Locale): string {
  return translate(locale, `catalog.coverage.${type}` as TranslationKey);
}

/**
 * Creates claim types (with fields and required documents) for a company.
 * Type names and descriptions use the company language; field and document
 * labels are catalog content (English or French).
 */
export async function createCoverage(tx: Tx, companyId: string, types: CoverageType[], locale: Locale, firstSortOrder = 1) {
  await loadMessages(locale);
  const created = [];
  for (let index = 0; index < types.length; index++) {
    const type = types[index];
    const def = coverageDefinition(type)!;
    created.push(await tx.claimType.create({
      data: {
        companyId,
        typeName: def.type,
        displayName: coverageLabel(def.type, locale),
        description: translate(locale, `catalog.coverage.${def.type}.desc` as TranslationKey),
        detectionKeywords: def.keywords,
        isActive: true,
        confidenceThreshold: def.confidenceThreshold,
        requiresConfirmation: false,
        sortOrder: firstSortOrder + index,
        fields: { create: claimFieldRows(type, locale) },
      },
    }));
  }
  return created;
}

async function upsertSetting(tx: Tx, companyId: string, name: string, data: { description: string; type: 'TEXT' | 'BOOLEAN'; textValue?: string; boolValue?: boolean }, adminId?: string) {
  const existing = await tx.setting.findFirst({ where: { companyId, name } });
  if (existing) {
    return tx.setting.update({ where: { id: existing.id }, data: { ...data, isActive: true, updatedBy: adminId } });
  }
  return tx.setting.create({ data: { ...data, name, companyId, isActive: true, createdBy: adminId, updatedBy: adminId } });
}

/** Stores the on/off behaviour toggles as BOOLEAN settings. */
export async function saveBehaviorToggles(tx: Tx, companyId: string, toggles: Partial<BehaviorToggles>, locale: Locale, adminId?: string) {
  for (const toggle of BEHAVIOR_TOGGLES) {
    const value = toggles[toggle.key as BehaviorToggleKey];
    if (typeof value !== 'boolean') continue;
    await upsertSetting(tx, companyId, toggle.key, { description: toggle.label[contentLocale(locale)], type: 'BOOLEAN', boolValue: value }, adminId);
  }
}

export interface KnowledgeInfo {
  contactEmail: string;
  contactPhone: string;
  claimsEmail?: string;
  businessHours?: string;
  address?: string;
  city: string;
  country: string;
  coverageLabels: string[];
}

/**
 * Text settings that the WhatsApp assistant reads as its knowledge base
 * (same names the bot already understands: support_phone, business_hours…).
 */
export async function seedKnowledgeSettings(tx: Tx, companyId: string, info: KnowledgeInfo, locale: Locale, adminId?: string) {
  const fr = contentLocale(locale) === 'fr';
  const rows: Array<[string, string, string | undefined]> = [
    ['support_phone', fr ? 'Numéro de support principal' : 'Main support phone number', info.contactPhone],
    ['support_email', fr ? 'E-mail du support client' : 'Customer support email', info.contactEmail],
    ['claims_email', fr ? 'E-mail dédié aux sinistres' : 'Claims email', info.claimsEmail],
    ['business_hours', fr ? "Heures d'ouverture" : 'Business hours', info.businessHours],
    ['company_address', fr ? "Adresse de l'entreprise" : 'Company address', [info.address, info.city, info.country].filter(Boolean).join(', ')],
    ['primary_language', fr ? 'Langue principale' : 'Primary language', primaryLanguageValue(locale)],
    ['policy_types', fr ? 'Types de couverture proposés' : 'Coverage types offered', info.coverageLabels.join(', ')],
  ];
  for (const [name, description, value] of rows) {
    if (!value) continue;
    await upsertSetting(tx, companyId, name, { description, type: 'TEXT', textValue: value }, adminId);
  }
}
