import type { MiddlewareHandler } from 'hono';
import { getClientIp } from '../services/auth.js';

interface Bucket {
  timestamps: number[];
  expiresAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5000;

function pruneBuckets(now: number): void {
  if (buckets.size < MAX_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.expiresAt <= now) buckets.delete(key);
  }
}

export interface RateLimitOptions {
  name: string;
  windowMs: number;
  limit: () => number;
}

export function rateLimit(options: RateLimitOptions): MiddlewareHandler {
  return async (c, next) => {
    const maxRequests = options.limit();
    const now = Date.now();
    pruneBuckets(now);

    const ip = getClientIp(c);
    const key = `${options.name}:${ip}`;
    const cutoff = now - options.windowMs;

    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [], expiresAt: now + options.windowMs };
      buckets.set(key, bucket);
    }

    bucket.timestamps = bucket.timestamps.filter((ts) => ts > cutoff);
    if (bucket.timestamps.length >= maxRequests) {
      const oldest = bucket.timestamps[0] ?? now;
      const retryAfterSec = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      c.header('Retry-After', String(retryAfterSec));
      if (c.req.path === '/raw' || c.req.path.startsWith('/raw/')) {
        return c.text('Too many requests. Please try again shortly.\n', 429);
      }
      return c.json(
        {
          error: 'Too many requests. Please try again shortly.',
          message: 'Too many requests. Please try again shortly.',
        },
        429
      );
    }

    bucket.timestamps.push(now);
    bucket.expiresAt = now + options.windowMs;
    await next();
  };
}

export function resetRateLimitsForTests(): void {
  buckets.clear();
}
