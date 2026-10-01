import crypto from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import Joi from 'joi';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { redisRateLimit } from '@/lib/redis';
import { getClientIp } from '@/lib/clientIp';
import { parseSignupInput, type SignupErrors } from '@/lib/company/signupInput';
import { coverageLabel, createCoverage, saveBehaviorToggles, seedKnowledgeSettings } from '@/lib/company/seed';
import {
  DEFAULT_CHATBOT_MODEL,
  DEFAULT_MAX_TOKENS,
  DEFAULT_TEMPERATURE,
  defaultSystemPrompt,
  defaultWelcomeMessage,
} from '@/lib/company/prompts';

// Same cost as the existing admin registration flow.
const BCRYPT_ROUNDS = 12;

const loginEmail = Joi.string().email();

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };

function conflict(fields: SignupErrors) {
  return NextResponse.json({ error: 'conflict', fields }, { status: 409, headers: noStore });
}

/**
 * POST /api/signup
 * Creates a company, its super admin (server-generated password) and all
 * default tenant data in one transaction. The plaintext password is returned
 * exactly once in the response and never logged or stored.
 */
export async function POST(request: NextRequest) {
  const limit = Number(process.env.SIGNUP_RATE_LIMIT_PER_HOUR) || 5;
  // Same client-IP rule as login: X-Forwarded-For only counts when TRUSTED_PROXY is set.
  const rate = await redisRateLimit(`signup:${getClientIp(request)}`, 60 * 60 * 1000, limit);
  if (!rate.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: noStore });
  }

  const { input, errors } = parseSignupInput(body);
  // The login form validates emails with Joi (IANA TLD list); apply the same rule
  // here so a company can never be created with an admin email that cannot sign in.
  for (const field of ['adminEmail', 'contactEmail', 'claimsEmail'] as const) {
    const value = input[field];
    if (!errors[field] && value && loginEmail.validate(value).error) errors[field] = 'invalid_email';
  }
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'validation_failed', fields: errors }, { status: 400, headers: noStore });
  }

  const domain = input.domain || `${input.slug}.local`;

  // Friendly duplicate checks (the unique indexes still guard against races).
  const [nameTaken, slugTaken, domainTaken, emailTaken] = await Promise.all([
    prisma.company.findFirst({ where: { name: { equals: input.companyName, mode: 'insensitive' } }, select: { id: true } }),
    prisma.company.findUnique({ where: { slug: input.slug }, select: { id: true } }),
    prisma.company.findUnique({ where: { domain }, select: { id: true } }),
    prisma.admin.findUnique({ where: { email: input.adminEmail }, select: { id: true } }),
  ]);
  const taken: SignupErrors = {};
  if (nameTaken) taken.companyName = 'taken';
  if (slugTaken) taken.slug = 'taken';
  if (domainTaken) taken[input.domain ? 'domain' : 'slug'] = 'taken';
  if (emailTaken) taken.adminEmail = 'taken';
  if (Object.keys(taken).length > 0) return conflict(taken);

  const password = crypto.randomUUID();
  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const locale = input.language;

  try {
    const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const company = await tx.company.create({
        data: {
          name: input.companyName,
          slug: input.slug,
          domain,
          schema: `tenant_${input.slug.replace(/-/g, '_')}`,
          logoUrl: input.logoUrl || null,
          primaryColor: input.primaryColor || null,
          botLanguage: locale,
          uiLanguage: locale,
          contactEmail: input.contactEmail,
          contactPhone: input.contactPhone,
          country: input.country,
          city: input.city,
          address: input.address || null,
        },
      });

      const admin = await tx.admin.create({
        data: {
          companyId: company.id,
          email: input.adminEmail,
          firstName: input.adminFirstName,
          lastName: input.adminLastName,
          passwordHash,
          role: 'SUPER_ADMIN',
        },
      });

      // SUPER_ADMIN role grants everything; roles are authoritative (lib/users/roles.ts).

      // Pre-set assistant instructions in the chosen language. The Go bot reads
      // the snake_case columns, Prisma the camelCase ones: fill both.
      const welcomeMessage = await defaultWelcomeMessage(locale, company.name);
      const systemPrompt = defaultSystemPrompt(locale, company.name);
      await tx.chatbotConfig.create({
        data: {
          companyId: company.id,
          welcomeMessage,
          welcome_message: welcomeMessage,
          systemPrompt,
          system_prompt: systemPrompt,
          maxTokens: DEFAULT_MAX_TOKENS,
          max_tokens: BigInt(DEFAULT_MAX_TOKENS),
          temperature: DEFAULT_TEMPERATURE,
          model: DEFAULT_CHATBOT_MODEL,
          isActive: true,
          is_active: true,
        },
      });

      if (input.whatsappDisplayNumber) {
        await tx.integrationSettings.create({ data: { companyId: company.id, whatsappDisplayNumber: input.whatsappDisplayNumber } });
      }

      const claimTypes = await createCoverage(tx, company.id, input.coverage, locale);
      await saveBehaviorToggles(tx, company.id, input.toggles, locale, admin.id);
      await seedKnowledgeSettings(tx, company.id, {
        contactEmail: input.contactEmail,
        contactPhone: input.contactPhone,
        claimsEmail: input.claimsEmail || undefined,
        businessHours: input.businessHours || undefined,
        address: input.address || undefined,
        city: input.city,
        country: input.country,
        coverageLabels: input.coverage.map((type) => coverageLabel(type, locale)),
      }, locale, admin.id);

      return { company, admin, claimTypes };
    }, { timeout: 30_000 });

    return NextResponse.json({
      company: { id: result.company.id, name: result.company.name, slug: result.company.slug, language: locale },
      admin: { email: result.admin.email, firstName: result.admin.firstName, lastName: result.admin.lastName, role: result.admin.role },
      coverage: result.claimTypes.map((ct: { typeName: string }) => ct.typeName),
      // Shown once by the signup success screen. Never persisted in plaintext.
      password,
    }, { status: 201, headers: noStore });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String((error.meta?.target as string[] | string | undefined) ?? '');
      if (target.includes('email')) return conflict({ adminEmail: 'taken' });
      if (target.includes('name')) return conflict({ companyName: 'taken' });
      if (target.includes('domain')) return conflict({ domain: 'taken' });
      return conflict({ slug: 'taken' });
    }
    // Log only the error type: request data (and the password) must never reach logs.
    const code = error instanceof Prisma.PrismaClientKnownRequestError ? error.code : (error as Error)?.name;
    console.error('[signup] company creation failed:', code);
    return NextResponse.json({ error: 'signup_failed' }, { status: 500, headers: noStore });
  }
}
