import config from './config';
import { deleteExpiredPastes, getAllPastes, getPastes } from './db';

type Paste = { id: string; content: string; name?: string; permanent?: any; createdAt: string; expiresAt?: string };

let cached: { ts: number; total: number; items: Paste[] } | null = null;
let started = false;

export async function refreshCache() {
  await deleteExpiredPastes();
  // attempt to get all pastes efficiently via getPastes with a very large limit
  const pageResult = await getPastes(1, Number(process.env.PRECACHE_FETCH_LIMIT || 1000000));
  cached = { ts: Date.now(), total: pageResult.total, items: pageResult.items };
  return cached;
}

export async function getPage(page: number, limit: number, force = false) {
  const ttlMs = (config.cache.ttl || 3600) * 1000;
  if (force || !cached || Date.now() - cached.ts > ttlMs) {
    await refreshCache();
  }
  const total = cached ? cached.total : 0;
  const start = (page - 1) * limit;
  const items = cached ? cached.items.slice(start, start + limit) : [];
  return { total, items };
}

export function invalidateCache() {
  cached = null;
}

export function startPrecache() {
  if (started) return;
  started = true;
  try {
    // start cron if available
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const cron = require('node-cron');
    const schedule = process.env.PRECACHE_CRON || config.cache_settings.precache_cron || '*/1 * * * *'; // every minute
    cron.schedule(schedule, async () => {
      try {
        await refreshCache();
        // console.log('Pastes cache refreshed by cron');
      } catch (err) {
        // console.error('Precache error', err);
      }
    });
    // initial fill
    refreshCache().catch(() => {});
  } catch (err) {
    // node-cron not installed or failed; ignore
  }
}

// start automatically
startPrecache();

export default { refreshCache, getPage, invalidateCache, startPrecache };

