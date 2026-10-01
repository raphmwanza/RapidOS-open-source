import { test } from 'node:test';
import assert from 'node:assert/strict';

// Another company's claim or document must answer 404, exactly like one that does not exist:
// a 403 would confirm to the caller that the claim number or document id is real.

process.env.JWT_ACCESS_SECRET ||= 'unit-test-access-secret-0123456789abcdef0123456789';
process.env.JWT_REFRESH_SECRET ||= 'unit-test-refresh-secret-0123456789abcdef012345678';

const COMPANY_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';
const COMPANY_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb';
const ADMIN_A = 'aaaaaaaa-3333-4333-8333-aaaaaaaaaaaa';

const claims = [
  { id: 'claim-a', claimNumber: 'ACTI-A-0001', companyId: COMPANY_A, customerId: 'cust-a' },
  { id: 'claim-b', claimNumber: 'OTHR-B-0001', companyId: COMPANY_B, customerId: 'cust-b' },
];
const documents = [
  { id: 'doc-a', claimId: 'claim-a', fileName: 'a.jpg', fileType: 'image/jpeg', filePath: '', base64Data: Buffer.from('jpeg-a').toString('base64'), claim: { companyId: COMPANY_A } },
  { id: 'doc-b', claimId: 'claim-b', fileName: 'b.jpg', fileType: 'image/jpeg', filePath: '', base64Data: Buffer.from('jpeg-b').toString('base64'), claim: { companyId: COMPANY_B } },
];
const admins: Record<string, unknown> = {
  [ADMIN_A]: { id: ADMIN_A, companyId: COMPANY_A, role: 'SUPER_ADMIN', email: 'a@unit.test', isActive: true, tokenVersion: 0, company: { id: COMPANY_A, isActive: true } },
};

// Minimal Prisma stand-in: `where` objects are matched field by field (nested for relations).
function matches(row: any, where: any): boolean {
  return Object.entries(where || {}).every(([k, v]) =>
    v !== null && typeof v === 'object' ? matches(row?.[k], v) : row?.[k] === v);
}
const pick = (rows: any[]) => async ({ where }: any) => rows.find((r) => matches(r, where)) ?? null;
(globalThis as any).__globalPrisma__ = {
  claim: { findFirst: pick(claims), findUnique: pick(claims) },
  claimDocument: { findFirst: pick(documents) },
  admin: { findUnique: async ({ where }: any) => admins[where.id] ?? null },
};

async function setup() {
  const { NextRequest } = await import('next/server');
  const { generateTokens } = await import('../../lib/auth');
  const { resolveClaimAccess } = await import('../../lib/claimAccess');
  const documentRoute = await import('../../app/api/documents/[claimId]/[documentId]/route');
  const { accessToken } = generateTokens({ adminId: ADMIN_A, companyId: COMPANY_A, role: 'SUPER_ADMIN', email: 'a@unit.test', tv: 0 } as any);
  const req = (path: string) => new NextRequest(`http://localhost${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  return { req, resolveClaimAccess, documentRoute };
}

test('a claim of another company answers 404, like an unknown claim number', async () => {
  const { req, resolveClaimAccess } = await setup();
  const own = await resolveClaimAccess(req('/api/claims/ACTI-A-0001/pdf'), 'ACTI-A-0001');
  assert.ok(!(own instanceof Response), 'own claim must resolve');
  assert.equal((own as any).claim.id, 'claim-a');

  for (const number of ['OTHR-B-0001', 'NOPE-0000']) {
    const res = await resolveClaimAccess(req(`/api/claims/${number}/documents`), number);
    assert.ok(res instanceof Response);
    assert.equal((res as Response).status, 404, `${number} must be 404`);
    assert.deepEqual(await (res as Response).json(), { error: 'Claim not found' });
  }
});

test('a document of another company answers 404, like an unknown document', async () => {
  const { req, documentRoute } = await setup();
  const own = await documentRoute.GET(req('/api/documents/claim-a/doc-a'), { params: { claimId: 'claim-a', documentId: 'doc-a' } });
  assert.equal(own.status, 200);
  assert.equal(Buffer.from(await own.arrayBuffer()).toString(), 'jpeg-a');

  for (const [claimId, documentId] of [['claim-b', 'doc-b'], ['claim-a', 'doc-b'], ['claim-x', 'doc-x']]) {
    const res = await documentRoute.GET(req(`/api/documents/${claimId}/${documentId}`), { params: { claimId, documentId } });
    assert.equal(res.status, 404, `${claimId}/${documentId} must be 404`);
  }
});
