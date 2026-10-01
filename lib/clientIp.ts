import type { NextRequest } from 'next/server';

/** Set by scripts/socket-ip.cjs from the TCP peer address; any client-sent value is overwritten. */
export const SOCKET_IP_HEADER = 'x-rapidos-socket-ip';

/**
 * TRUSTED_PROXY controls whether X-Forwarded-For is believed:
 * - unset / "false" / "0": ignore proxy headers and use the socket address (default).
 * - "true": one trusted proxy in front (e.g. nginx, Caddy, a cloud load balancer).
 * - a number N: N trusted proxy hops in front.
 * With N trusted hops the client is the N-th address from the right of
 * `X-Forwarded-For, <socket address>`; addresses added by the client itself are skipped.
 */
export function trustedProxyHops(value = process.env.TRUSTED_PROXY): number {
  const v = (value || '').trim().toLowerCase();
  if (!v || v === 'false' || v === '0' || v === 'no' || v === 'off') return 0;
  if (v === 'true' || v === 'yes' || v === 'on') return 1;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? Math.min(n, 10) : 0;
}

function normalizeIp(ip: string): string {
  const trimmed = ip.trim();
  // IPv4-mapped IPv6 (::ffff:1.2.3.4) -> 1.2.3.4
  return trimmed.startsWith('::ffff:') && trimmed.includes('.') ? trimmed.slice(7) : trimmed;
}

/** Client IP for rate limiting. Never trusts X-Forwarded-For unless TRUSTED_PROXY is set. */
export function getClientIp(request: Pick<NextRequest, 'headers'>, hops = trustedProxyHops()): string {
  const socketIp = normalizeIp(request.headers.get(SOCKET_IP_HEADER) || '');
  if (hops > 0) {
    const forwarded = (request.headers.get('x-forwarded-for') || '')
      .split(',')
      .map(normalizeIp)
      .filter(Boolean);
    const chain = socketIp ? [...forwarded, socketIp] : forwarded;
    const index = chain.length - 1 - hops;
    if (chain.length > 0) return chain[Math.max(index, 0)];
  }
  return socketIp || 'unknown';
}
