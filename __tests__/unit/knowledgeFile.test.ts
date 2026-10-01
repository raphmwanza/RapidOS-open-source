import { test } from 'node:test';
import assert from 'node:assert/strict';
import { knowledgeFileUrl, knowledgeFolder, knowledgeKeyFromUrl, keyBelongsToCompany } from '../../lib/storage/fileStore';

const company = '42aaa854-f585-4860-8a47-2e25e3a0ac5f';

test('knowledge documents are stored in the company folder and round-trip through their URL', () => {
  const key = `${knowledgeFolder(company)}/0b8f5a1e-1111-4222-8333-944455556666-Guide sinistres.pdf`;
  const url = knowledgeFileUrl(key);
  assert.ok(url.startsWith('/api/settings/file?key='));
  assert.equal(knowledgeKeyFromUrl(url), key);
  assert.ok(keyBelongsToCompany(key, company));
  assert.ok(!keyBelongsToCompany(key, '31e366f3-2f68-4a21-a804-55fdccadfc12'));
});

test('external and malformed knowledge URLs give no storage key', () => {
  assert.equal(knowledgeKeyFromUrl('https://file.io/abc'), null);
  assert.equal(knowledgeKeyFromUrl(null), null);
  assert.equal(knowledgeKeyFromUrl('/api/settings/file?key=' + encodeURIComponent(`companies/${company}/claims/x/y.pdf`)), null);
  assert.equal(knowledgeKeyFromUrl('/api/settings/file?key=' + encodeURIComponent(`companies/${company}/knowledge/../../etc`)), null);
});
