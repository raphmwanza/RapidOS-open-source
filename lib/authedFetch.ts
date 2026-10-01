import { refreshAccessToken } from './tokenRefresh';
import { errorCodeOf, loginUrl, noteSignedOut, signedOutReason } from './sessionNotice';

/**
 * Helper to call API endpoints with the access token and auto-refresh on 401.
 * Uses the global singleton refresh to prevent concurrent refresh calls
 * that would trigger token reuse attack detection.
 */
export async function authedFetch(input: RequestInfo | URL, init: RequestInit = {}, retry = true): Promise<Response> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const headers = new Headers(init.headers || {});

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(input, { ...init, headers, credentials: init.credentials ?? 'include' });

  if (res.status !== 401 || !retry) {
    return res;
  }

  console.log('authedFetch: Got 401, attempting token refresh via singleton...');
  noteSignedOut(await errorCodeOf(res));

  // Use global singleton refresh (prevents concurrent refresh race conditions)
  const result = await refreshAccessToken();

  if (!result.success) {
    console.log('authedFetch: Refresh failed, returning original 401');
    // Signed out because the account signed in elsewhere: go to the login page, which
    // explains why. This is final (no refresh can succeed), so it cannot loop.
    if (signedOutReason() && typeof window !== 'undefined' && window.location.pathname !== '/login') {
      localStorage.removeItem('accessToken');
      window.location.assign(loginUrl());
    }
    // Otherwise do NOT reload here — AuthProvider handles redirects.
    // A hard reload would reset all in-memory state and cause infinite loops.
    return res; // give original 401
  }

  // Retry once with new token
  const newToken = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const retryHeaders = new Headers(init.headers || {});
  if (newToken) {
    retryHeaders.set('Authorization', `Bearer ${newToken}`);
  }

  console.log('authedFetch: Retrying with new token');
  return fetch(input, { ...init, headers: retryHeaders, credentials: init.credentials ?? 'include' });
}
