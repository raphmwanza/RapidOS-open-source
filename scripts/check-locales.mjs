#!/usr/bin/env node
/**
 * Checks the dashboard and WhatsApp-bot translations against the locale
 * registry (lib/i18n/locales.ts). Run with `npm run check:locales`.
 *
 * Errors (exit code 1):
 *  - a registered locale without lib/i18n/locales/<code>.json or
 *    backend/internal/service/botlocales/<code>.json, or a file for an
 *    unregistered code
 *  - unknown keys, empty strings, or placeholders ({name}) that differ from English
 *  - a missing key in a reviewed locale (en, fr) or in any bot locale
 *    (every bot locale must be complete; the bot falls back to English at runtime)
 *  - bot languageName/nativeName not matching the registry
 *  - a catalog coverage type or behaviour toggle without its catalog.* keys
 * Missing dashboard keys in machine-translated locales are allowed (English
 * fallback) and reported as coverage. Pass --strict to make them errors.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(root, 'lib/i18n/locales');
const botDir = path.join(root, 'backend/internal/service/botlocales');
const strict = process.argv.includes('--strict');

const errors = [];
const warnings = [];
const err = (msg) => errors.push(msg);

// --- registry ---------------------------------------------------------------
const registrySrc = fs.readFileSync(path.join(root, 'lib/i18n/locales.ts'), 'utf8');
const registryBlock = registrySrc.slice(registrySrc.indexOf('LOCALE_REGISTRY = ['), registrySrc.indexOf('] as const'));
const registry = [...registryBlock.matchAll(/\{([^{}]*)\}/g)].map(([, body]) => {
  const field = (name) => body.match(new RegExp(`${name}:\\s*'([^']*)'`))?.[1];
  return { code: field('code'), name: field('name'), nativeName: field('nativeName'), dir: field('dir'), reviewed: /reviewed:\s*true/.test(body) };
});
if (!registry.length) err('could not parse LOCALE_REGISTRY in lib/i18n/locales.ts');
const codes = registry.map((l) => l.code);
for (const l of registry) {
  if (!l.code || !l.name || !l.nativeName || !['ltr', 'rtl'].includes(l.dir)) err(`registry entry incomplete: ${JSON.stringify(l)}`);
}
if (new Set(codes).size !== codes.length) err('duplicate codes in LOCALE_REGISTRY');
if (codes[0] !== 'en') err('English (en) must be the first registry entry (it is the fallback)');

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
const readJson = (file) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    err(`${path.relative(root, file)}: ${e.code === 'ENOENT' ? 'missing' : e.message}`);
    return null;
  }
};

function compare(label, en, dict, { requireAll }) {
  let missing = 0;
  for (const [key, value] of Object.entries(dict)) {
    if (!(key in en)) { err(`${label}: unknown key "${key}"`); continue; }
    if (typeof value !== 'string' || !value.trim()) { err(`${label}: empty value for "${key}"`); continue; }
    if (placeholders(value) !== placeholders(en[key])) err(`${label}: "${key}" placeholders {${placeholders(value)}} ≠ English {${placeholders(en[key])}}`);
  }
  for (const key of Object.keys(en)) {
    if (!(key in dict)) {
      missing++;
      if (requireAll) err(`${label}: missing key "${key}"`);
    }
  }
  return missing;
}

// --- dashboard dictionaries ---------------------------------------------------
const uiEn = readJson(path.join(uiDir, 'en.json')) || {};
const uiTotal = Object.keys(uiEn).length;
const coverage = [];
for (const l of registry) {
  const dict = l.code === 'en' ? uiEn : readJson(path.join(uiDir, `${l.code}.json`));
  if (!dict) continue;
  const missing = compare(`ui/${l.code}`, uiEn, dict, { requireAll: l.reviewed || strict });
  coverage.push({ code: l.code, ui: uiTotal - missing });
}
for (const f of fs.readdirSync(uiDir)) {
  if (f.endsWith('.json') && !codes.includes(f.slice(0, -5))) err(`lib/i18n/locales/${f}: no registry entry for "${f.slice(0, -5)}"`);
}

// catalog keys used through template strings (t(`catalog.coverage.${type}`))
const catalogSrc = fs.readFileSync(path.join(root, 'lib/company/catalog.ts'), 'utf8');
const coverageTypes = [...catalogSrc.matchAll(/type:\s*'([A-Z_]+)',\s*icon:/g)].map((m) => m[1]);
const toggleKeys = [...catalogSrc.slice(catalogSrc.indexOf('BEHAVIOR_TOGGLES')).matchAll(/key:\s*'([a-z_]+)'/g)].map((m) => m[1]);
for (const t of coverageTypes) for (const k of [`catalog.coverage.${t}`, `catalog.coverage.${t}.desc`]) if (!(k in uiEn)) err(`ui/en: missing "${k}" for coverage type ${t}`);
for (const t of toggleKeys) for (const k of [`catalog.toggle.${t}`, `catalog.toggle.${t}.desc`]) if (!(k in uiEn)) err(`ui/en: missing "${k}" for toggle ${t}`);

// --- WhatsApp bot templates ------------------------------------------------------
const botEn = readJson(path.join(botDir, 'en.json')) || {};
for (const l of registry) {
  const dict = l.code === 'en' ? botEn : readJson(path.join(botDir, `${l.code}.json`));
  if (!dict) continue;
  compare(`bot/${l.code}`, botEn, dict, { requireAll: true });
  if (dict.languageName !== l.name) err(`bot/${l.code}: languageName "${dict.languageName}" ≠ registry name "${l.name}"`);
  if (dict.nativeName !== l.nativeName) err(`bot/${l.code}: nativeName "${dict.nativeName}" ≠ registry nativeName "${l.nativeName}"`);
}
for (const f of fs.readdirSync(botDir)) {
  if (f.endsWith('.json') && !codes.includes(f.slice(0, -5))) err(`botlocales/${f}: no registry entry for "${f.slice(0, -5)}"`);
}

// --- report ------------------------------------------------------------------------
console.log(`Locales: ${registry.length} registered, ${uiTotal} dashboard strings, ${Object.keys(botEn).length} bot strings\n`);
console.log('code  dir  reviewed  dashboard coverage');
for (const l of registry) {
  const c = coverage.find((x) => x.code === l.code);
  const pct = c ? Math.round((c.ui / uiTotal) * 100) : 0;
  console.log(`${l.code.padEnd(5)} ${l.dir}  ${(l.reviewed ? 'yes' : 'no').padEnd(8)}  ${String(c?.ui ?? 0).padStart(4)}/${uiTotal} (${pct}%)`);
}
for (const w of warnings) console.warn(`warning: ${w}`);
if (errors.length) {
  console.error(`\n${errors.length} error(s):`);
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}
console.log('\nAll locales OK (missing dashboard keys fall back to English).');
