// Helpers for the WhatsApp (Meta) webhook configuration shown in Settings.
// The Go API serves the webhook at a fixed path; only the public base URL
// (how Meta reaches the API, e.g. an ngrok tunnel) varies per deployment.

import { firstRuntimeEnv } from '@/lib/runtimeEnv';

export const WEBHOOK_PATH = '/api/v1/whatsapp/webhook';

/** Verify tokens are shared secrets: 8-128 printable ASCII characters, no spaces. */
export const VERIFY_TOKEN_PATTERN = /^[\x21-\x7E]{8,128}$/;

export function isValidVerifyToken(value: string): boolean {
  return VERIFY_TOKEN_PATTERN.test(value);
}

export type BaseUrlResult = { ok: true; value: string | null } | { ok: false };

/**
 * Normalizes a public base URL: http(s) only, no query/fragment/credentials,
 * trailing slashes removed. A pasted full callback URL is reduced to its base.
 */
export function normalizePublicBaseUrl(input: unknown): BaseUrlResult {
  const raw = typeof input === 'string' ? input.trim() : '';
  if (!raw) return { ok: true, value: null };
  if (raw.length > 300) return { ok: false };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false };
  }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash) {
    return { ok: false };
  }
  let path = url.pathname.replace(/\/+$/, '');
  if (path.endsWith(WEBHOOK_PATH)) path = path.slice(0, -WEBHOOK_PATH.length).replace(/\/+$/, '');
  return { ok: true, value: `${url.protocol}//${url.host}${path}` };
}

export function webhookCallbackUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${WEBHOOK_PATH}`;
}

/** Meta only calls publicly reachable HTTPS endpoints. */
export function isPublicHttpsUrl(baseUrl: string): boolean {
  try {
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false;
    if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return false;
    if (host === '[::1]' || host.startsWith('[fc') || host.startsWith('[fd') || host.startsWith('[fe80')) return false;
    return true;
  } catch {
    return false;
  }
}

/** Server-side default shown until an admin saves an override. */
export function defaultPublicBaseUrl(): string {
  const fromEnv = firstRuntimeEnv('PUBLIC_API_URL', 'NEXT_PUBLIC_API_URL') || 'http://localhost:8080';
  const normalized = normalizePublicBaseUrl(fromEnv);
  return (normalized.ok && normalized.value) || 'http://localhost:8080';
}
