/**
 * Global singleton for token refresh.
 * Ensures only ONE refresh request is in-flight at a time across the entire app
 * (AuthProvider + authedFetch + any other caller).
 * Prevents the race condition where two concurrent refresh calls cause
 * token rotation to revoke the first successfully-rotated token.
 */

import { noteSignedOut } from './sessionNotice';
import { notifyAuthChange } from './authEvents';

let refreshPromise: Promise<RefreshResult> | null = null;
let lastFailureTime = 0;
const FAILURE_COOLDOWN_MS = 5000; // Don't retry for 5s after a failure

interface RefreshResult {
  success: boolean;
  /** Error code of a failed refresh, e.g. session_replaced. */
  code?: string;
  accessToken?: string;
  admin?: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    company: {
      id: string;
      name: string;
      slug: string;
      domain: string;
      isActive: boolean;
    };
  };
}

/**
 * Attempt to refresh the access token using the refresh token cookie.
 * If a refresh is already in-flight, returns the same promise (deduplication).
 * If a refresh recently failed, returns failure immediately (cooldown).
 */
export function refreshAccessToken(): Promise<RefreshResult> {
  // If we recently failed, don't retry (prevents loops)
  if (Date.now() - lastFailureTime < FAILURE_COOLDOWN_MS) {
    console.log('tokenRefresh: In cooldown after recent failure, skipping');
    return Promise.resolve({ success: false });
  }

  // If a refresh is already in-flight, return the same promise
  if (refreshPromise) {
    console.log('tokenRefresh: Reusing in-flight refresh promise');
    return refreshPromise;
  }

  console.log('tokenRefresh: Starting new refresh request');
  refreshPromise = doRefresh();
  return refreshPromise;
}

async function doRefresh(): Promise<RefreshResult> {
  try {
    const response = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    });

    console.log('tokenRefresh: Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.log('tokenRefresh: Failed:', errorText);
      lastFailureTime = Date.now();
      let code: string | undefined;
      try { code = JSON.parse(errorText)?.code; } catch { /* not JSON */ }
      noteSignedOut(code);

      // If refresh token is invalid/revoked, clear auth state
      if (response.status === 401 || response.status === 403) {
        if (typeof window !== 'undefined') {
          localStorage.removeItem('accessToken');
          notifyAuthChange();
        }
      }

      return { success: false, code };
    }

    const data = await response.json();

    if (data?.accessToken && typeof window !== 'undefined') {
      localStorage.setItem('accessToken', data.accessToken);
      notifyAuthChange();
      console.log('tokenRefresh: Success - new access token stored');
      // Reset failure tracking on success
      lastFailureTime = 0;
      return {
        success: true,
        accessToken: data.accessToken,
        admin: data.admin,
      };
    }

    console.log('tokenRefresh: No access token in response');
    lastFailureTime = Date.now();
    return { success: false };
  } catch (error) {
    console.error('tokenRefresh: Request failed:', error);
    lastFailureTime = Date.now();
    return { success: false };
  } finally {
    // Clear the in-flight promise so the next call starts fresh
    refreshPromise = null;
  }
}

/**
 * Check if a refresh recently failed (within cooldown period).
 */
export function isRefreshOnCooldown(): boolean {
  return Date.now() - lastFailureTime < FAILURE_COOLDOWN_MS;
}

/**
 * Reset the failure state (e.g., after a successful login).
 */
export function resetRefreshState(): void {
  lastFailureTime = 0;
  refreshPromise = null;
}
