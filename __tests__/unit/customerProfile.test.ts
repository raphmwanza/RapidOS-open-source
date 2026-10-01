import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeCustomerProfile, planCustomerMerge, splitFullName } from '../../lib/customers/profile';

test('a new claim only fills empty profile fields', () => {
  const existing = { firstName: 'Grace', lastName: 'Mukendi', email: null, policyNumber: 'POL-1', address: '' };
  const update = mergeCustomerProfile(existing, { firstName: 'Ezali', lastName: 'Grace', email: 'g@x.cd', policyNumber: 'POL-9', address: 'Av. 12' });
  assert.deepEqual(update, { email: 'g@x.cd', address: 'Av. 12' });
});

test('an explicit correction overwrites the corrected field only', () => {
  const existing = { firstName: 'Patrik', lastName: 'Mbuyi', email: 'old@x.cd', policyNumber: 'POL-1' };
  assert.deepEqual(mergeCustomerProfile(existing, { firstName: 'Patrick', lastName: 'Mbuyi', email: 'new@x.cd', policyNumber: 'POL-2' }, ['insuredFullName']), { firstName: 'Patrick' });
  assert.deepEqual(mergeCustomerProfile(existing, { policyNumber: 'POL-2' }, ['policyNumber']), { policyNumber: 'POL-2' });
});

test('a missing last name is completed when the first name matches', () => {
  assert.deepEqual(mergeCustomerProfile({ firstName: 'Grace', lastName: null }, { firstName: 'grace', lastName: 'Mukendi' }), { lastName: 'Mukendi' });
  assert.deepEqual(mergeCustomerProfile({ firstName: 'Grace', lastName: null }, { firstName: 'Jean', lastName: 'Kabila' }), {});
});

test('an empty profile takes the whole incoming name', () => {
  assert.deepEqual(mergeCustomerProfile({ firstName: null, lastName: null }, splitFullName('Grace Mukendi')), { firstName: 'Grace', lastName: 'Mukendi' });
});

test('merge plan keeps the oldest record and fills its empty fields in creation order', () => {
  const plan = planCustomerMerge([
    { id: 'c', createdAt: '2026-09-20', phoneNumber: '243812345678', firstName: 'WhatsApp', policyNumber: 'POL-2', address: 'Av. Lumumba 12' },
    { id: 'a', createdAt: '2026-09-01', phoneNumber: '+243 812 345 678', firstName: 'Grace', lastName: null },
    { id: 'b', createdAt: '2026-09-10', phoneNumber: '0812345678', firstName: 'Grace', lastName: 'Mukendi', email: 'grace@example.com', policyNumber: 'POL-1' },
  ]);
  assert.equal(plan.keep.id, 'a');
  assert.deepEqual(plan.merged.map((m) => m.id), ['b', 'c']);
  assert.deepEqual(plan.fill, { lastName: 'Mukendi', email: 'grace@example.com', policyNumber: 'POL-1', address: 'Av. Lumumba 12' });
});
