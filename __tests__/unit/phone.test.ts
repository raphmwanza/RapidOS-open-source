/** node --import tsx --test __tests__/unit/*.test.ts  (npm run test:unit) */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { callingCodeFor, normalizePhoneE164, phoneLookupVariants } from '../../lib/phone';

test('every format of one DRC number gives the same E.164', () => {
  const cc = callingCodeFor('RDC');
  assert.equal(cc, '243');
  for (const raw of ['+243 812 345 678', '+243812345678', '00243812345678', '243812345678', '0812345678', '081 234 5678', '812345678', '+243-812-345-678', '(+243) 812.345.678']) {
    assert.equal(normalizePhoneE164(raw, cc), '+243812345678', raw);
  }
});

test('country names and the contact phone give the calling code', () => {
  assert.equal(callingCodeFor('République Démocratique du Congo'), '243');
  assert.equal(callingCodeFor('Kenya'), '254');
  assert.equal(callingCodeFor(null, '+254 700 111 222'), '254');
  assert.equal(callingCodeFor('Atlantis', null), null);
});

test('national numbers without a calling code are rejected, not guessed', () => {
  assert.equal(normalizePhoneE164('0812345678', null), null);
  assert.equal(normalizePhoneE164('812345678', null), null);
  assert.equal(normalizePhoneE164('15550093001', null), '+15550093001'); // international digits (a WhatsApp wa_id)
});

test('garbage is rejected', () => {
  for (const raw of ['', 'abc', '+12', '+1234567890123456', '12ab34567890', '++243812345678']) {
    assert.equal(normalizePhoneE164(raw, '243'), null, raw);
  }
});

test('lookup variants cover rows stored before E.164', () => {
  assert.deepEqual(phoneLookupVariants('+243812345678'), ['+243812345678', '243812345678']);
});
