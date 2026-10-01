/**
 * One active session per account.
 *
 * Every login creates a new session id, stores it in admins.current_session_id and
 * puts it in the access and refresh tokens ("sid"). Refreshing keeps the session id.
 * Tokens carrying any other session id are rejected with code `session_replaced`,
 * so the previous browser is signed out on its next request, access tokens included.
 */
export const SESSION_REPLACED_CODE = 'session_replaced';
export const SESSION_REPLACED_MESSAGE = 'You were signed out because this account signed in on another device';

/** True when the token belongs to the account's current session. */
export function sessionIsCurrent(payload: { sid?: string | null }, admin: { currentSessionId: string | null }): boolean {
  // No login since single sessions were introduced: older tokens stay valid until the next login.
  if (!admin.currentSessionId) return true;
  return payload.sid === admin.currentSessionId;
}

export const sessionReplacedBody = { error: SESSION_REPLACED_MESSAGE, code: SESSION_REPLACED_CODE } as const;
