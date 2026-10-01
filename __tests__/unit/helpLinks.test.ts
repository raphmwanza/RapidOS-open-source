import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HELP_LINKS } from '../../lib/helpLinks';
import { API_GROUPS } from '../../lib/marketing/api';

// Dashboard "Help" links (sidebar, user card, Settings and Users cards) must land on a
// docs page and an anchor that exist, so renaming a docs heading cannot break them silently.
const root = process.cwd();

function pageSource(route: string): string {
  const file = path.join(root, 'app', ...route.split('/').filter(Boolean), 'page.tsx');
  assert.ok(fs.existsSync(file), `no docs page for ${route} (${file})`);
  return fs.readFileSync(file, 'utf8');
}

test('every help link points to an existing docs page and anchor', () => {
  for (const [key, href] of Object.entries(HELP_LINKS)) {
    assert.match(href, /^\/docs(\/[a-z-]+)*(#[a-z0-9-]+)?$/, `${key}: unexpected href ${href}`);
    const [route, anchor] = href.split('#');
    const src = pageSource(route);
    if (!anchor) continue;
    if (route === '/docs/api' && API_GROUPS.some((g) => g.id === anchor)) continue; // rendered as <H2 id={g.id}>
    assert.ok(src.includes(`id="${anchor}"`), `${key}: #${anchor} not found in ${route}`);
  }
});

test('the dashboard uses the help links (no hard-coded docs URLs)', () => {
  const files = ['components/LayoutWrapper.tsx', 'components/settings/WhatsAppIntegrationCard.tsx', 'app/settings/page.tsx', 'app/users/page.tsx'];
  const used = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(path.join(root, f), 'utf8');
    assert.doesNotMatch(src, /href=["'`]\/docs/, `${f} hard-codes a docs URL; use HELP_LINKS`);
    for (const m of src.matchAll(/HELP_LINKS\.([a-zA-Z]+)/g)) used.add(m[1]);
  }
  assert.deepEqual([...used].sort(), Object.keys(HELP_LINKS).sort());
});
