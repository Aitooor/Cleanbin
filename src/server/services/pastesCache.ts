import cron, { type ScheduledTask } from 'node-cron';
import { deleteExpiredPastes, getAllPastes } from './pastes.js';
import type { PasteRecord } from '../../shared/types.js';

let cached: { ts: number; total: number; items: PasteRecord[] } | null = null;
let cronTask: ScheduledTask | null = null;

const PAGE_CACHE_TTL_MS = 30_000;

export async function refreshCache() {
  const items = await getAllPastes();
  cached = { ts: Date.now(), total: items.length, items };
  return cached;
}

export async function getCachedPage(page: number, limit: number, force = false) {
  if (force || !cached || Date.now() - cached.ts > PAGE_CACHE_TTL_MS) {
    await refreshCache();
  }
  const total = cached ? cached.total : 0;
  const start = (page - 1) * limit;
  const items = cached ? cached.items.slice(start, start + limit) : [];
  return { total, items };
}

export function invalidateCache(): void {
  cached = null;
}

export function addPasteToCache(paste: PasteRecord): void {
  if (!cached) return;
  cached.items.unshift(paste);
  cached.total += 1;
  cached.ts = Date.now();
}

export function removePasteFromCache(id: string): void {
  if (!cached) return;
  const before = cached.items.length;
  cached.items = cached.items.filter((p) => p.id !== id);
  if (cached.items.length !== before) {
    cached.total = Math.max(0, cached.total - 1);
    cached.ts = Date.now();
  }
}

export function updatePasteInCache(id: string, patch: Partial<PasteRecord>): void {
  if (!cached) return;
  let changed = false;
  cached.items = cached.items.map((p) => {
    if (p.id === id) {
      changed = true;
      return { ...p, ...patch };
    }
    return p;
  });
  if (changed) cached.ts = Date.now();
}

export function startExpiryCron(): void {
  if (cronTask) return;
  const schedule = process.env.PRECACHE_CRON || '*/1 * * * *';
  cronTask = cron.schedule(schedule, async () => {
    try {
      const purged = await deleteExpiredPastes();
      if (purged.length > 0) invalidateCache();
    } catch {
      // Best-effort background cleanup
    }
  });
}

export function stopExpiryCron(): void {
  if (cronTask) {
    cronTask.stop();
    cronTask = null;
  }
}
