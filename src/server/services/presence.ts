import { normalizeEmail } from '../../shared/validation.js';

const getPresenceTtlMs = () => Math.max(500, Number(process.env.PRESENCE_TTL_MS) || 20_000);

type PastePresence = Map<string, number>;
const store = new Map<string, PastePresence>();

function prune(entries: PastePresence, now: number): void {
  const ttl = getPresenceTtlMs();
  for (const [email, ts] of entries) {
    if (now - ts > ttl) entries.delete(email);
  }
}

export function heartbeat(pasteId: string, email: string): string[] {
  const normalized = normalizeEmail(email);
  const now = Date.now();
  let entries = store.get(pasteId);
  if (!entries) {
    entries = new Map();
    store.set(pasteId, entries);
  }
  prune(entries, now);
  entries.set(normalized, now);
  return [...entries.keys()].filter((candidate) => candidate !== normalized).sort();
}

export function viewers(pasteId: string, excludeEmail?: string): string[] {
  const entries = store.get(pasteId);
  if (!entries) return [];
  prune(entries, Date.now());
  if (entries.size === 0) {
    store.delete(pasteId);
    return [];
  }
  const exclude = excludeEmail ? normalizeEmail(excludeEmail) : null;
  return [...entries.keys()].filter((email) => email !== exclude).sort();
}

// Fast pre-filter: returns only candidate IDs that actually have active editors
// in memory, so callers avoid querying SQL for idle pastes.
export function activeEntriesFor(pasteIds: string[], excludeEmail?: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  for (const pasteId of pasteIds) {
    const editors = viewers(pasteId, excludeEmail);
    if (editors.length > 0) result[pasteId] = editors;
  }
  return result;
}

export function clearPresence(pasteId?: string): void {
  if (pasteId) store.delete(pasteId);
  else store.clear();
}
