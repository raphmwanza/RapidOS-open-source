/**
 * Remembers why the browser was signed out so the login page can explain it
 * (e.g. "this account signed in on another device"). Client side only.
 */
const KEY = 'rapidos.signedOutReason';
const KNOWN = new Set(['session_replaced']);

/** Record the error code of a 401 when it explains a forced sign-out. */
export function noteSignedOut(code: unknown): void {
  if (typeof window === 'undefined' || typeof code !== 'string' || !KNOWN.has(code)) return;
  try { window.sessionStorage.setItem(KEY, code); } catch { /* storage unavailable */ }
}

export function signedOutReason(): string | null {
  if (typeof window === 'undefined') return null;
  try { return window.sessionStorage.getItem(KEY); } catch { return null; }
}

export function clearSignedOutReason(): void {
  if (typeof window === 'undefined') return;
  try { window.sessionStorage.removeItem(KEY); } catch { /* storage unavailable */ }
}

/** /login, with ?reason=... when the sign-out had a known cause. */
export function loginUrl(): string {
  const reason = signedOutReason();
  return reason ? `/login?reason=${encodeURIComponent(reason)}` : '/login';
}

/** Error code of a JSON error response, without consuming the original body. */
export async function errorCodeOf(res: Response): Promise<string | null> {
  try {
    const data = await res.clone().json();
    return typeof data?.code === 'string' ? data.code : null;
  } catch {
    return null;
  }
}
