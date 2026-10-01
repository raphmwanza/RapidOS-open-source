import { NextRequest, NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { authMiddleware } from '@/lib/middleware';
import { decryptSecret, encryptSecret, maskSecret } from '@/lib/encryption';
import { applyBotLanguage } from '@/lib/company/preferences';
import { normalizeLocale } from '@/lib/i18n';
import { ADMIN_ROLES } from '@/lib/users/roles';
import { WEBHOOK_PATH, defaultPublicBaseUrl, isValidVerifyToken, normalizePublicBaseUrl } from '@/lib/whatsapp/webhook';

const roles = [...ADMIN_ROLES];
const noStore = { 'Cache-Control': 'no-store' };
// Secrets are write-only: stored AES-256-GCM encrypted and only returned masked.
const secretFields = {
  whatsappAccessToken: 'whatsappAccessTokenCipher',
  metaAppSecret: 'metaAppSecretCipher',
  webhookVerifyToken: 'webhookVerifyTokenCipher',
  llmApiKey: 'llmApiKeyCipher',
} as const;

function response(settings: any, status = 200) {
  const webhook = { path: WEBHOOK_PATH, defaultBaseUrl: defaultPublicBaseUrl() };
  if (!settings) return NextResponse.json({ settings: null, webhook }, { status, headers: noStore });
  const result: any = { ...settings };
  for (const [publicName, column] of Object.entries(secretFields)) {
    delete result[column];
    result[`${publicName}Masked`] = maskSecret(settings[column]);
  }
  return NextResponse.json({ settings: result, webhook }, { status, headers: noStore });
}

function fail(error: string, status = 400) {
  return NextResponse.json({ error }, { status, headers: noStore });
}

/** Meta's GET challenge is matched by token alone, so a token must identify one company. */
async function verifyTokenInUse(companyId: string, token: string): Promise<boolean> {
  const others = await prisma.integrationSettings.findMany({
    where: { companyId: { not: companyId }, webhookVerifyTokenCipher: { not: null } },
    select: { webhookVerifyTokenCipher: true },
  });
  return others.some(({ webhookVerifyTokenCipher }: { webhookVerifyTokenCipher: string | null }) => {
    try {
      return !!webhookVerifyTokenCipher && decryptSecret(webhookVerifyTokenCipher) === token;
    } catch {
      return false;
    }
  });
}

export async function GET(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: roles });
  if (error) return error;
  const admin = (request as any).admin;
  return response(await prisma.integrationSettings.findUnique({ where: { companyId: admin.companyId } }));
}

export async function PUT(request: NextRequest) {
  const error = await authMiddleware(request, { requiredRole: roles });
  if (error) return error;
  try {
    const admin = (request as any).admin;
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail('invalid_body');
    if (body.llmProvider && !['gemini', 'openai', 'deepseek', 'qwen', 'openai-compatible'].includes(body.llmProvider)) {
      return fail('unsupported_llm_provider');
    }
    const data: Record<string, string | null | undefined> = {};
    for (const field of ['whatsappDisplayNumber', 'whatsappPhoneNumberId', 'whatsappBusinessAccountId', 'llmProvider', 'llmModel', 'llmBaseUrl']) {
      if (typeof body[field] === 'string') data[field] = body[field].trim().slice(0, 300) || null;
    }
    for (const field of ['whatsappPhoneNumberId', 'whatsappBusinessAccountId']) {
      if (data[field] && !/^\d{5,32}$/.test(data[field] as string)) return fail(`invalid_${field}`);
    }
    if (typeof body.publicBaseUrl === 'string') {
      const base = normalizePublicBaseUrl(body.publicBaseUrl);
      if (!base.ok) return fail('invalid_public_base_url');
      data.publicBaseUrl = base.value;
    }
    const verifyToken = typeof body.webhookVerifyToken === 'string' ? body.webhookVerifyToken.trim() : '';
    if (verifyToken) {
      if (!isValidVerifyToken(verifyToken)) return fail('invalid_verify_token');
      if (await verifyTokenInUse(admin.companyId, verifyToken)) return fail('verify_token_in_use', 409);
    }
    if (data.whatsappPhoneNumberId) {
      // Incoming messages are routed to a tenant by phone number id.
      const owner = await prisma.integrationSettings.findFirst({
        where: { whatsappPhoneNumberId: data.whatsappPhoneNumberId, companyId: { not: admin.companyId } }, select: { id: true },
      });
      if (owner) return fail('phone_number_id_in_use', 409);
    }
    for (const [field, column] of Object.entries(secretFields)) {
      if (typeof body[field] === 'string' && body[field].trim()) data[column] = encryptSecret(body[field].trim());
    }
    const companyData: { name?: string; logoUrl?: string | null; primaryColor?: string | null } = {};
    if (typeof body.companyName === 'string' && body.companyName.trim()) companyData.name = body.companyName.trim();
    if (typeof body.logoUrl === 'string') companyData.logoUrl = body.logoUrl.trim() || null;
    if (typeof body.primaryColor === 'string') {
      const color = body.primaryColor.trim();
      if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) return fail('invalid_primary_color');
      companyData.primaryColor = color || null;
    }
    const botLanguage = body.botLanguage ? normalizeLocale(body.botLanguage) : null;
    if (body.botLanguage && !botLanguage) return fail('unsupported_bot_language');
    if (Object.keys(companyData).length) await prisma.company.update({ where: { id: admin.companyId }, data: companyData });
    // Switching language also swaps the default (unedited) prompt and welcome message.
    if (botLanguage) await prisma.$transaction((tx: Prisma.TransactionClient) => applyBotLanguage(tx, admin.companyId, botLanguage));
    const settings = await prisma.integrationSettings.upsert({
      where: { companyId: admin.companyId }, create: { companyId: admin.companyId, ...data }, update: data,
    });
    return response(settings);
  } catch {
    return fail('save_failed', 500);
  }
}
