import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { API_GROUPS, curlFor, endpointAnchor } from '../../lib/marketing/api';

// Keeps the public API reference (/docs/api) in sync with the real routes.
const root = process.cwd();
const all = API_GROUPS.flatMap((g) => g.endpoints);
const key = (method: string, p: string) => `${method} ${p.split('?')[0]}`;

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name === 'route.ts' ? [path.join(dir, d.name)] : [],
  );
}

function dashboardRoutes(): Set<string> {
  const out = new Set<string>();
  for (const file of walk(path.join(root, 'app', 'api'))) {
    const src = fs.readFileSync(file, 'utf8');
    const route = '/' + path.relative(path.join(root, 'app'), path.dirname(file)).split(path.sep).join('/').replace(/\[([^\]]+)\]/g, '{$1}');
    for (const m of src.matchAll(/export (?:async )?function (GET|POST|PUT|PATCH|DELETE)\b/g)) out.add(`${m[1]} ${route}`);
  }
  return out;
}

function goRoutes(): Set<string> {
  const go = fs.readFileSync(path.join(root, 'backend', 'internal', 'router', 'router.go'), 'utf8');
  const prefixes: Record<string, string> = {
    r: '',
    api: '/api/v1',
    whatsapp: '/api/v1/whatsapp',
    internal: '/api/v1/internal',
    notifications: '/api/v1/protected/notifications',
  };
  const out = new Set<string>();
  for (const m of go.matchAll(/\b(r|api|whatsapp|internal|notifications)\.(GET|POST|PUT|PATCH|DELETE)\("([^"]+)"/g)) {
    out.add(`${m[2]} ${prefixes[m[1]]}${m[3]}`);
  }
  return out;
}

test('every dashboard and Go API route is documented', () => {
  const documented = new Set(all.map((e) => key(e.method, e.path)));
  const routes = [...dashboardRoutes(), ...goRoutes()];
  assert.ok(routes.length > 50, `expected to find the routes, found ${routes.length}`);
  const missing = routes.filter((r) => !documented.has(r));
  assert.deepEqual(missing, [], `undocumented routes: ${missing.join(', ')}`);
});

test('every documented route still exists', () => {
  const dash = dashboardRoutes();
  const go = goRoutes();
  const stale = all.filter((e) => !(e.service === 'api' ? go : dash).has(key(e.method, e.path))).map((e) => key(e.method, e.path));
  assert.deepEqual(stale, [], `documented but not found: ${stale.join(', ')}`);
});

test('examples are valid and anchors are unique', () => {
  const anchors = new Set<string>();
  for (const e of all) {
    const anchor = endpointAnchor(e);
    assert.ok(!anchors.has(anchor), `duplicate anchor ${anchor}`);
    anchors.add(anchor);
    if (e.body && !e.form && !e.curl && e.method !== 'GET') assert.doesNotThrow(() => JSON.parse(e.body as string), `${e.method} ${e.path} body is not JSON`);
    assert.match(curlFor(e), /^curl /m);
  }
});
