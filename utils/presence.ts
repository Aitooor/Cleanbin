import { normalizeEmail } from './pasteAccess';

// In-memory "who is editing this paste" registry, modelled after Google Docs
// presence. A heartbeat is a (pasteId, email, timestamp) entry; entries older
// than PRESENCE_TTL_MS are pruned on every read, so an editor disappears once
// they stop beating. No WebSockets and no external dependencies: the dashboard
// polls instead. The TTL is configurable purely so tests can use a short window.
const PRESENCE_TTL_MS = Math.max(500, Number(process.env.PRESENCE_TTL_MS) || 20_000);

type PastePresence = Map<string, number>;

const store = new Map<string, PastePresence>();

function prune(entries: PastePresence, now: number): void {
    for (const [email, ts] of entries) {
        if (now - ts > PRESENCE_TTL_MS) entries.delete(email);
    }
}

// Registers a heartbeat and returns the *other* editors currently active on the
// paste, sorted for stable rendering.
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

// Editors currently active on a paste, optionally excluding the caller.
export function viewers(pasteId: string, excludeEmail?: string): string[] {
    const entries = store.get(pasteId);
    if (!entries) return [];
    prune(entries, Date.now());
    const exclude = excludeEmail ? normalizeEmail(excludeEmail) : null;
    return [...entries.keys()].filter((email) => email !== exclude).sort();
}

export function viewersFor(pasteIds: string[], excludeEmail?: string): Record<string, string[]> {
    const result: Record<string, string[]> = {};
    for (const pasteId of pasteIds) {
        const editors = viewers(pasteId, excludeEmail);
        if (editors.length > 0) result[pasteId] = editors;
    }
    return result;
}

// Test/cleanup hook: forget every entry (optionally for a single paste).
export function clearPresence(pasteId?: string): void {
    if (pasteId) store.delete(pasteId);
    else store.clear();
}
