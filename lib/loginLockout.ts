import { getRedisClient } from './redis';
import { logger } from './logger';

const lockoutLogger = logger.child({ service: 'login-lockout' });

function positiveInt(value: string | undefined, fallback: number): number {
  const n = Number.parseInt(value || '', 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** Failed sign-ins allowed per account before it is locked (LOGIN_MAX_FAILURES, default 5). */
export const loginMaxFailures = () => positiveInt(process.env.LOGIN_MAX_FAILURES, 5);
/** Lockout / failure-counting window in minutes (LOGIN_LOCKOUT_MINUTES, default 15). */
export const loginLockoutSeconds = () => positiveInt(process.env.LOGIN_LOCKOUT_MINUTES, 15) * 60;

const key = (email: string) => `login-fail:${email}`;

/**
 * Per-account lockout, independent of the client IP. Unknown emails are counted too so
 * the response does not reveal whether an account exists. Fails open if Redis is down,
 * like the IP limiter.
 */
export async function getAccountLock(email: string): Promise<{ locked: boolean; retryAfterSeconds: number }> {
  try {
    const client = await getRedisClient();
    const count = Number.parseInt((await client.get(key(email))) || '0', 10);
    if (count < loginMaxFailures()) return { locked: false, retryAfterSeconds: 0 };
    const ttl = await client.ttl(key(email));
    return { locked: true, retryAfterSeconds: ttl > 0 ? ttl : loginLockoutSeconds() };
  } catch (error) {
    lockoutLogger.error('Lockout check failed, allowing', error);
    return { locked: false, retryAfterSeconds: 0 };
  }
}

export async function recordLoginFailure(email: string): Promise<void> {
  try {
    const client = await getRedisClient();
    const count = await client.incr(key(email));
    // The window starts at the first failure; reaching the limit restarts it as the lockout.
    if (count === 1 || count >= loginMaxFailures()) {
      await client.expire(key(email), loginLockoutSeconds());
    }
  } catch (error) {
    lockoutLogger.error('Failed to record login failure', error);
  }
}

export async function clearLoginFailures(email: string): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.del(key(email));
  } catch (error) {
    lockoutLogger.error('Failed to clear login failures', error);
  }
}
