import { createClient, RedisClientType } from 'redis';
import { logger } from './logger';

const redisLogger = logger.child({ service: 'redis' });

let redisClient: RedisClientType | null = null;
let isConnecting = false;

/**
 * Get Redis client instance (singleton pattern)
 */
export async function getRedisClient(): Promise<RedisClientType> {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  if (isConnecting) {
    // Wait for connection to complete
    await new Promise(resolve => setTimeout(resolve, 100));
    return getRedisClient();
  }

  isConnecting = true;

  try {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      throw new Error('REDIS_URL env var is required');
    }
    
    redisClient = createClient({
      url: redisUrl,
      socket: {
        connectTimeout: 5000,
        reconnectStrategy: (retries) => {
          if (retries > 3) {
            redisLogger.error('Max reconnection attempts reached', undefined, { retries });
            return new Error('Max reconnection attempts reached');
          }
          return Math.min(retries * 100, 3000);
        }
      }
    });

    redisClient.on('error', (err) => {
      redisLogger.error('Redis client error', err);
    });

    redisClient.on('connect', () => {
      redisLogger.info('Connected successfully');
    });

    redisClient.on('reconnecting', () => {
      redisLogger.info('Reconnecting...');
    });

    await redisClient.connect();
    isConnecting = false;
    return redisClient;
  } catch (error) {
    isConnecting = false;
    redisLogger.error('Connection failed', error);
    throw error;
  }
}

/**
 * Rate limiting using Redis
 * Returns true if request is allowed, false if rate limited
 */
export async function redisRateLimit(
  identifier: string,
  windowMs: number = 15 * 60 * 1000, // 15 minutes default
  maxRequests: number = 100
): Promise<{ allowed: boolean; remaining: number; resetTime: number }> {
  try {
    const client = await getRedisClient();
    const key = `ratelimit:${identifier}`;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Use a sorted set to track requests with timestamps
    // Remove old entries outside the window
    await client.zRemRangeByScore(key, 0, windowStart);

    // Count current requests in window
    const currentCount = await client.zCard(key);

    if (currentCount >= maxRequests) {
      // Get the oldest request timestamp to calculate reset time
      const oldestEntries = await client.zRange(key, 0, 0);
      const oldestTimestamp = oldestEntries.length > 0 ? parseInt(oldestEntries[0]) : now;
      const resetTime = oldestTimestamp + windowMs;

      return {
        allowed: false,
        remaining: 0,
        resetTime
      };
    }

    // Add current request
    // Unique member so concurrent requests in the same millisecond are all counted.
    await client.zAdd(key, { score: now, value: `${now}-${Math.random().toString(36).slice(2, 10)}` });
    
    // Set TTL on the key to auto-cleanup
    await client.expire(key, Math.ceil(windowMs / 1000));

    return {
      allowed: true,
      remaining: maxRequests - currentCount - 1,
      resetTime: now + windowMs
    };
  } catch (error) {
    redisLogger.error('Rate limit check failed, falling back to allow', error);
    // On Redis failure, allow the request (fail open)
    return { allowed: true, remaining: maxRequests, resetTime: Date.now() + windowMs };
  }
}

/**
 * Store a value in Redis with optional TTL
 */
export async function redisSet(key: string, value: string, ttlSeconds?: number): Promise<void> {
  try {
    const client = await getRedisClient();
    if (ttlSeconds) {
      await client.setEx(key, ttlSeconds, value);
    } else {
      await client.set(key, value);
    }
  } catch (error) {
    redisLogger.error('Set operation failed', error, { key });
    throw error;
  }
}

/**
 * Get a value from Redis
 */
export async function redisGet(key: string): Promise<string | null> {
  try {
    const client = await getRedisClient();
    return await client.get(key);
  } catch (error) {
    redisLogger.error('Get operation failed', error, { key });
    return null;
  }
}

/**
 * Delete a key from Redis
 */
export async function redisDel(key: string): Promise<void> {
  try {
    const client = await getRedisClient();
    await client.del(key);
  } catch (error) {
    redisLogger.error('Delete operation failed', error, { key });
  }
}

/**
 * Add a token to the blacklist (for logout/revocation)
 * TTL should match the token's remaining lifetime
 */
export async function blacklistToken(tokenId: string, ttlSeconds: number): Promise<void> {
  const key = `blacklist:${tokenId}`;
  await redisSet(key, '1', ttlSeconds);
}

/**
 * Check if a token is blacklisted
 */
export async function isTokenBlacklisted(tokenId: string): Promise<boolean> {
  const key = `blacklist:${tokenId}`;
  const result = await redisGet(key);
  return result !== null;
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedis(): Promise<void> {
  if (redisClient && redisClient.isOpen) {
    await redisClient.quit();
    redisClient = null;
  }
}
