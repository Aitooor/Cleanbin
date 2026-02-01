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

// Fast in-memory updates to make listings reflect changes instantly without a full refresh.
export function addPasteToCache(paste: Paste) {
  if (!cached) {
    cached = { ts: Date.now(), total: 1, items: [paste] };
    return;
  }
  // Prepend newest paste to the cached list and update total + timestamp.
  cached.items.unshift(paste);
  cached.total = (cached.total || 0) + 1;
  cached.ts = Date.now();
}

export function removePasteFromCache(id: string) {
  if (!cached) return;
  const before = cached.items.length;
  cached.items = cached.items.filter((p) => p.id !== id);
  const after = cached.items.length;
  if (before !== after) {
    cached.total = Math.max(0, (cached.total || 0) - 1);
    cached.ts = Date.now();
  }
}

export function updatePasteNameInCache(id: string, name: string) {
  if (!cached) return;
  let changed = false;
  cached.items = cached.items.map((p) => {
    if (p.id === id) {
      changed = true;
      return { ...p, name };
    }
    return p;
  });
  if (changed) cached.ts = Date.now();
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

