import { test } from 'node:test';
import assert from 'node:assert/strict';

// One active session per account: a second sign-in makes the access token of the
// first one fail with 401 session_replaced (lib/sessionPolicy.ts, lib/middleware.ts).

process.env.JWT_ACCESS_SECRET ||= 'unit-test-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET ||= 'unit-test-refresh-secret-0123456789abcdef012345678';

const COMPANY = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const ADMIN = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';
const SID_FIRST = '11111111-1111-4111-8111-111111111111';
const SID_SECOND = '22222222-2222-4222-8222-222222222222';

const admin: Record<string, any> = {
  id: ADMIN, companyId: COMPANY, role: 'SUPER_ADMIN', email: 'john@unit.test', firstName: 'John', lastName: 'Doe',
  isActive: true, tokenVersion: 0, currentSessionId: SID_FIRST, uiLanguage: null,
  company: { id: COMPANY, name: 'Unit', slug: 'unit', domain: 'unit.local', isActive: true, uiLanguage: 'en' },
};
(globalThis as any).__globalPrisma__ = {
  admin: { findUnique: async ({ where }: any) => (where.id === ADMIN ? admin : null) },
};

async function setup() {
  const { NextRequest } = await import('next/server');
  const { generateTokens } = await import('../../lib/auth');
  const { authMiddleware } = await import('../../lib/middleware');
  const verify = await import('../../app/api/auth/verify/route');
  const token = (sid?: string) =>
    generateTokens({ adminId: ADMIN, companyId: COMPANY, role: 'SUPER_ADMIN', email: 'john@unit.test', tv: 0, sid } as any).accessToken;
  const req = (t: string) => new NextRequest('http://localhost/api/claims', { headers: { Authorization: `Bearer ${t}` } });
  return { req, token, authMiddleware, verify };
}

test('sessionIsCurrent: only the latest sign-in is current', async () => {
  const { sessionIsCurrent } = await import('../../lib/sessionPolicy');
  assert.equal(sessionIsCurrent({ sid: 'a' }, { currentSessionId: 'a' }), true);
  assert.equal(sessionIsCurrent({ sid: 'a' }, { currentSessionId: 'b' }), false);
  assert.equal(sessionIsCurrent({}, { currentSessionId: 'b' }), false, 'a token from before single sessions is replaced by a new login');
  assert.equal(sessionIsCurrent({ sid: 'a' }, { currentSessionId: null }), true, 'accounts that never signed in since the upgrade keep working');
});

test('second sign-in: the first access token gets 401 session_replaced, the second works', async () => {
  const { req, token, authMiddleware } = await setup();
  const first = token(SID_FIRST);
  admin.currentSessionId = SID_FIRST;
  assert.equal(await authMiddleware(req(first)), null, 'first session works before the second sign-in');

  admin.currentSessionId = SID_SECOND; // what POST /api/auth/login stores
  const second = token(SID_SECOND);
  const rejected = await authMiddleware(req(first));
  assert.equal(rejected?.status, 401);
  const body = await rejected!.json();
  assert.equal(body.code, 'session_replaced');
  assert.match(body.error, /signed in on another device/);
  assert.equal(await authMiddleware(req(second)), null, 'second session works');
});

test('GET /api/auth/verify also rejects the replaced session', async () => {
  const { req, token, verify } = await setup();
  admin.currentSessionId = SID_SECOND;
  const old = await verify.GET(req(token(SID_FIRST)));
  assert.equal(old.status, 401);
  assert.equal((await old.json()).code, 'session_replaced');
  const current = await verify.GET(req(token(SID_SECOND)));
  assert.equal(current.status, 200);
});

test('the signed-out notice survives the redirect to /login', async () => {
  const notice = await import('../../lib/sessionNotice');
  const store = new Map<string, string>();
  (globalThis as any).window = {
    sessionStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) },
  };
  try {
    assert.equal(notice.loginUrl(), '/login');
    notice.noteSignedOut('some_other_code');
    assert.equal(notice.loginUrl(), '/login', 'unknown codes are ignored');
    const res = new Response(JSON.stringify({ error: 'x', code: 'session_replaced' }), { status: 401 });
    notice.noteSignedOut(await notice.errorCodeOf(res));
    assert.equal(notice.loginUrl(), '/login?reason=session_replaced');
    notice.clearSignedOutReason();
    assert.equal(notice.loginUrl(), '/login');
  } finally {
    delete (globalThis as any).window;
  }
});
