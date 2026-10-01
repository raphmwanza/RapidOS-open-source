import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { firstRuntimeEnv, runtimeEnv } from '../../lib/runtimeEnv';

// Next.js inlines literal `process.env.NEXT_PUBLIC_*` reads at build time, also in server
// code, so a URL set on the host after the image was built would be ignored. Server code
// reads them through lib/runtimeEnv.ts instead.
const root = process.cwd();
const SCANNED = ['app', 'lib', 'components', 'config', 'middleware.ts'];

function sourceFiles(entry: string): string[] {
  const full = path.join(root, entry);
  if (!fs.existsSync(full)) return [];
  if (fs.statSync(full).isFile()) return [full];
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((d) => {
    const child = path.join(entry, d.name);
    if (d.isDirectory()) return sourceFiles(child);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(d.name) ? [path.join(root, child)] : [];
  });
}

test('no source file reads process.env.NEXT_PUBLIC_* directly', () => {
  const offenders = SCANNED.flatMap(sourceFiles)
    .filter((file) => !file.endsWith(path.join('lib', 'runtimeEnv.ts')))
    .filter((file) => /process\.env\.NEXT_PUBLIC_/.test(fs.readFileSync(file, 'utf8')))
    .map((file) => path.relative(root, file));
  assert.deepEqual(offenders, [], `use runtimeEnv() instead in: ${offenders.join(', ')}`);
});

test('runtimeEnv reads the current value and ignores blank values', () => {
  const key = 'RAPIDOS_TEST_RUNTIME_ENV';
  delete process.env[key];
  assert.equal(runtimeEnv(key), undefined);
  process.env[key] = '   ';
  assert.equal(runtimeEnv(key), undefined);
  process.env[key] = 'https://dashboard.example.com';
  assert.equal(runtimeEnv(key), 'https://dashboard.example.com');
  delete process.env[key];
});

test('firstRuntimeEnv returns the first variable that is set', () => {
  const [a, b] = ['RAPIDOS_TEST_FIRST_A', 'RAPIDOS_TEST_FIRST_B'];
  delete process.env[a];
  process.env[b] = 'https://api.example.com';
  assert.equal(firstRuntimeEnv(a, b), 'https://api.example.com');
  process.env[a] = 'https://public-api.example.com';
  assert.equal(firstRuntimeEnv(a, b), 'https://public-api.example.com');
  delete process.env[a];
  delete process.env[b];
});
