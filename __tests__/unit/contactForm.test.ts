import { test } from 'node:test';
import assert from 'node:assert/strict';
import { looksLikeBot, normalizeContact, validateContact } from '../../lib/contact/validate';

const valid = {
  fullName: '  Amina Diallo ',
  workEmail: 'Amina@Demo-Assurance.example.com',
  phone: '+243 81 000 0000',
  companyName: 'Demo Assurance',
  country: 'DR Congo',
  companyType: 'insurer',
  employees: '51-200',
  insuredCustomers: '10,000-100,000',
  claimsPerMonth: '200-1,000',
  coverages: ['Auto', 'Health', 'Auto'],
  deployment: 'hosted',
  desiredStart: '2026-11-01',
  heardFrom: 'LinkedIn',
  message: 'We would like a hosted RapidOS for our auto claims.',
};

test('a complete request is valid and normalised', () => {
  const input = normalizeContact(valid);
  assert.deepEqual(validateContact(input), {});
  assert.equal(input.fullName, 'Amina Diallo');
  assert.equal(input.workEmail, 'amina@demo-assurance.example.com');
  assert.deepEqual(input.coverages, ['Auto', 'Health']);
});

test('required fields, bad formats and unknown choices are reported per field', () => {
  assert.deepEqual(Object.keys(validateContact(normalizeContact({}))).sort(), [
    'claimsPerMonth', 'companyName', 'companyType', 'country', 'coverages', 'deployment', 'employees', 'fullName', 'insuredCustomers', 'message', 'phone', 'workEmail',
  ]);
  const bad = validateContact(normalizeContact({
    ...valid, workEmail: 'not-an-email', phone: '12ab', companyType: 'bank', employees: '7', coverages: ['Pets'],
    deployment: 'cloud', desiredStart: '2026-02-30', message: 'hi', fullName: 'x'.repeat(121),
  }));
  assert.deepEqual(bad, {
    workEmail: 'invalid_email', phone: 'invalid_phone', companyType: 'invalid_choice', employees: 'invalid_choice', coverages: 'invalid_choice',
    deployment: 'invalid_choice', desiredStart: 'invalid_date', message: 'too_short', fullName: 'too_long',
  });
  assert.equal(validateContact(normalizeContact({ ...valid, phone: '+1 23' })).phone, 'invalid_phone', 'too few digits');
  assert.deepEqual(validateContact(normalizeContact({ ...valid, desiredStart: '', heardFrom: '' })), {}, 'start date and source are optional');
  assert.equal(validateContact(normalizeContact({ ...valid, coverages: 'Auto' })).coverages, 'required', 'coverages must be a list');
});

test('honeypot and fill time catch bots', () => {
  const now = 1_000_000;
  assert.equal(looksLikeBot({ website: '', startedAt: now - 10_000 }, now), false);
  assert.equal(looksLikeBot({ website: 'http://spam.example', startedAt: now - 10_000 }, now), true, 'honeypot filled');
  assert.equal(looksLikeBot({ website: '', startedAt: now - 500 }, now), true, 'sent in under 3 seconds');
  assert.equal(looksLikeBot({ website: '' }, now), true, 'no start time');
});
