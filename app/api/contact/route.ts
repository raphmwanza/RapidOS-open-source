import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { redisRateLimit } from '@/lib/redis';
import { getClientIp } from '@/lib/clientIp';
import { looksLikeBot, normalizeContact, validateContact } from '@/lib/contact/validate';

const noStore = { 'Cache-Control': 'no-store, max-age=0', Pragma: 'no-cache' };
const MAX_BODY_BYTES = 32 * 1024;

/**
 * POST /api/contact
 * Saves a sales/contact request from the public /contact form in
 * contact_requests. Nothing is e-mailed. Bots (honeypot or a form sent in under
 * 3 seconds) get the same success answer but nothing is stored.
 */
export async function POST(request: NextRequest) {
  const ip = getClientIp(request);
  const perIp = Number(process.env.CONTACT_RATE_LIMIT_PER_HOUR) || 5;
  const rate = await redisRateLimit(`contact:${ip}`, 60 * 60 * 1000, perIp);
  const global = rate.allowed ? await redisRateLimit('contact:all', 60 * 60 * 1000, 200) : rate;
  if (!rate.allowed || !global.allowed) {
    return NextResponse.json({ error: 'rate_limited' }, { status: 429, headers: noStore });
  }

  const length = Number(request.headers.get('content-length') || 0);
  if (length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: 'too_large' }, { status: 413, headers: noStore });
  }
  let body: unknown;
  try {
    const text = await request.text();
    if (text.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'too_large' }, { status: 413, headers: noStore });
    }
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: noStore });
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400, headers: noStore });
  }
  const raw = body as Record<string, unknown>;

  if (looksLikeBot(raw)) {
    return NextResponse.json({ ok: true }, { status: 201, headers: noStore });
  }

  const input = normalizeContact(raw);
  const errors = validateContact(input);
  if (Object.keys(errors).length > 0) {
    return NextResponse.json({ error: 'validation_failed', fields: errors }, { status: 400, headers: noStore });
  }

  try {
    await prisma.contactRequest.create({
      data: {
        fullName: input.fullName,
        workEmail: input.workEmail,
        phone: input.phone,
        companyName: input.companyName,
        country: input.country,
        companyType: input.companyType,
        employees: input.employees,
        insuredCustomers: input.insuredCustomers,
        claimsPerMonth: input.claimsPerMonth,
        coverages: input.coverages,
        deployment: input.deployment,
        desiredStart: input.desiredStart ? new Date(`${input.desiredStart}T00:00:00Z`) : null,
        heardFrom: input.heardFrom || null,
        message: input.message,
        ipAddress: ip.slice(0, 64),
        userAgent: (request.headers.get('user-agent') || '').slice(0, 300) || null,
      },
    });
  } catch (error) {
    console.error('[contact] could not save the request', error instanceof Error ? error.message : error);
    return NextResponse.json({ error: 'save_failed' }, { status: 500, headers: noStore });
  }
  return NextResponse.json({ ok: true }, { status: 201, headers: noStore });
}
