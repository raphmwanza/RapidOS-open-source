// Lets UI outside the dashboard (the marketing header) follow sign-in state without
// an API call: the access token lives in localStorage, and this event fires when the
// app stores, verifies or drops it in this tab (other tabs get the "storage" event).
export const AUTH_CHANGE_EVENT = 'rapidos:auth-change';

export function hasAccessToken(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return Boolean(window.localStorage.getItem('accessToken'));
  } catch {
    return false;
  }
}

export function notifyAuthChange(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}
