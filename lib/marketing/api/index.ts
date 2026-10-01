import { authGroup, usersGroup } from './auth';
import { contactGroup } from './contact';
import { claimsGroup } from './claims';
import { conversationsGroup, customersGroup, mediaGroup } from './conversations';
import { analyticsGroup, settingsGroup } from './settings';
import { internalGroup, webhookGroup } from './goapi';
import type { ApiEndpoint, ApiGroup, AuthScheme } from './types';

export * from './types';
export { SIGNATURE_BASH, SIGNATURE_GO, SIGNATURE_NODE, WEBHOOK_IMAGE_MESSAGE, WEBHOOK_PAYLOAD } from './goapi';

/** Dashboard (Next.js, port 3000) routes first, then the Go API (port 8080). */
export const API_GROUPS: ApiGroup[] = [
  authGroup,
  usersGroup,
  claimsGroup,
  customersGroup,
  conversationsGroup,
  settingsGroup,
  analyticsGroup,
  mediaGroup,
  contactGroup,
  webhookGroup,
  internalGroup,
];

export const AUTH_SCHEMES: Record<AuthScheme, { label: string; description: string }> = {
  none: { label: 'Public', description: 'No authentication.' },
  jwt: { label: 'Bearer JWT', description: 'Authorization: Bearer <accessToken> from /api/auth/login or /api/auth/refresh.' },
  'jwt-or-pdf-token': { label: 'JWT or PDF link', description: 'Bearer JWT, or ?accessToken= from a signed 24-hour PDF link.' },
  'jwt-or-internal': { label: 'JWT or internal key', description: 'Bearer JWT, or X-Internal-API-Key + X-Company-ID (service calls).' },
  internal: { label: 'Internal key', description: 'X-Internal-API-Key: $INTERNAL_API_KEY and X-Company-ID: <company uuid>.' },
  'refresh-cookie': { label: 'Refresh cookie', description: 'The httpOnly refreshToken cookie set at login.' },
  'webhook-signature': { label: 'Meta signature', description: 'X-Hub-Signature-256: sha256=HMAC-SHA256(app secret, raw body).' },
  'verify-token': { label: 'Verify token', description: 'hub.verify_token must match a verify token saved in Settings.' },
};

export function endpointAnchor(e: Pick<ApiEndpoint, 'method' | 'path'>): string {
  return `${e.method}-${e.path}`.toLowerCase().replace(/\{([^}]+)\}/g, '$1').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function examplePath(path: string): string {
  return path
    .replace('{claimNumber}', 'DEMO-MG1Z2K-7QX4')
    .replace('{claimId}', '<claimId>')
    .replace('{documentId}', '<documentId>')
    .replace('{id}', '<id>')
    .replace('{key}', '<key>');
}

/** curl example generated from the method, path, auth scheme and example body. */
export function curlFor(e: ApiEndpoint): string {
  if (e.curl) return e.curl;
  const base = e.service === 'api' ? '$API' : '$BASE';
  const lines = [`curl${e.method === 'GET' ? '' : ` -X ${e.method}`} "${base}${examplePath(e.path)}"`];
  switch (e.auth) {
    case 'jwt':
    case 'jwt-or-pdf-token':
    case 'jwt-or-internal':
      lines.push('-H "Authorization: Bearer $TOKEN"');
      break;
    case 'internal':
      lines.push('-H "X-Internal-API-Key: $INTERNAL_API_KEY"', '-H "X-Company-ID: $COMPANY_ID"');
      break;
    case 'refresh-cookie':
      lines.push('-b cookies.txt -c cookies.txt');
      break;
    default:
      break;
  }
  if (e.form) {
    for (const [k, v] of Object.entries(e.form)) lines.push(`-F "${k}=${v}"`);
  } else if (e.body && e.method !== 'GET') {
    const compact = JSON.stringify(JSON.parse(e.body));
    lines.push('-H "Content-Type: application/json"', `-d '${compact.replace(/'/g, "'\\''")}'`);
  }
  return lines.join(' \\\n  ');
}

export function endpointCount(): { dashboard: number; api: number } {
  const all = API_GROUPS.flatMap((g) => g.endpoints);
  return { dashboard: all.filter((e) => e.service === 'dashboard').length, api: all.filter((e) => e.service === 'api').length };
}
