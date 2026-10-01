import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';

// Storage in a temp dir; no database (the merged-customer lookup degrades to "none").
process.env.FILE_STORAGE_DIR = mkdtempSync(path.join(tmpdir(), 'rapidos-media-'));
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://invalid:invalid@127.0.0.1:1/none';

const company = '11111111-1111-4111-8111-111111111111';
const customer = 'a0000000-0000-4000-8000-000000000001';
const other = 'a0000000-0000-4000-8000-000000000002';

test('cancelling a claim discards the pending media of that customer only', async () => {
  const { storePendingMedia, discardPendingMedia } = await import('../../lib/storage/documents');
  const { pendingFolder } = await import('../../lib/storage/fileStore');
  await storePendingMedia({ companyId: company, customerId: customer, fileName: 'car.jpg', mimeType: 'image/jpeg', data: Buffer.from('x'), uploadedBy: 'whatsapp' });
  await storePendingMedia({ companyId: company, customerId: customer, fileName: 'police.pdf', mimeType: 'application/pdf', data: Buffer.from('y'), uploadedBy: 'whatsapp' });
  await storePendingMedia({ companyId: company, customerId: other, fileName: 'keep.jpg', mimeType: 'image/jpeg', data: Buffer.from('z'), uploadedBy: 'whatsapp' });

  assert.equal(await discardPendingMedia(company, customer), 2);
  const mine = path.join(process.env.FILE_STORAGE_DIR!, pendingFolder(company, customer));
  assert.deepEqual(existsSync(mine) ? readdirSync(mine) : [], [], 'files and sidecars are gone');
  const theirs = path.join(process.env.FILE_STORAGE_DIR!, pendingFolder(company, other));
  assert.equal(readdirSync(theirs).filter((f) => !f.endsWith('.json')).length, 1, 'another customer keeps their media');
  assert.equal(await discardPendingMedia(company, customer), 0, 'nothing left to attach to a later claim');
});
