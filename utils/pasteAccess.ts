import type { Paste } from './db';
import type { SessionPayload } from './auth';

// Paste visibility scopes accepted by GET /api/pastes. `all` and `anonymous`
// are admin-only; `default` means "everything the session may see" (admin sees
// all pastes, a user sees their own plus the ones shared with them).
export type PasteScope = 'all' | 'mine' | 'shared' | 'anonymous' | 'default';

export type PasteViewer = Pick<SessionPayload, 'email' | 'role'> | null;

export function normalizeEmail(value: string | null | undefined): string {
    return (value ?? '').trim().toLowerCase();
}

export function getOwner(paste: Paste): string | null {
    return typeof paste.owner === 'string' && paste.owner ? normalizeEmail(paste.owner) : null;
}

export function getSharedWith(paste: Paste): string[] {
    if (!Array.isArray(paste.sharedWith)) return [];
    return paste.sharedWith.map((email) => normalizeEmail(email)).filter(Boolean);
}

export function isOwner(paste: Paste, email: string | null | undefined): boolean {
    const owner = getOwner(paste);
    return owner !== null && owner === normalizeEmail(email);
}

export function isAdmin(viewer: PasteViewer): boolean {
    return viewer?.role === 'admin';
}

// A viewer may edit a paste when they are an admin, its owner, or a listed
// collaborator.
export function canEdit(paste: Paste, viewer: PasteViewer): boolean {
    if (!viewer) return false;
    if (isAdmin(viewer)) return true;
    const email = normalizeEmail(viewer.email);
    return getOwner(paste) === email || getSharedWith(paste).includes(email);
}

// Resolves the effective scope for a request, clamping admin-only scopes for
// regular users and defaulting to whatever the viewer is allowed to list.
export function resolveScope(scopeParam: string | undefined, viewer: PasteViewer): PasteScope {
    const requested = (scopeParam || '').toLowerCase();
    if (requested === 'all' || requested === 'mine' || requested === 'shared' || requested === 'anonymous') {
        if (requested === 'all' || requested === 'anonymous') {
            return isAdmin(viewer) ? (requested as PasteScope) : 'default';
        }
        return requested;
    }
    return 'default';
}

export function matchesScope(paste: Paste, viewer: PasteViewer, scope: PasteScope): boolean {
    const owner = getOwner(paste);
    if (isAdmin(viewer)) {
        if (scope === 'all') return true;
        if (scope === 'mine') return owner !== null && owner === normalizeEmail(viewer!.email);
        if (scope === 'shared') return getSharedWith(paste).includes(normalizeEmail(viewer!.email));
        if (scope === 'anonymous') return owner === null;
        return true;
    }
    if (!viewer) return owner === null;
    const email = normalizeEmail(viewer.email);
    if (scope === 'mine') return owner === email;
    if (scope === 'shared') return getSharedWith(paste).includes(email);
    // Default for a regular user: own plus shared.
    return owner === email || getSharedWith(paste).includes(email);
}

export function selectVisible<T extends Paste>(pastes: T[], viewer: PasteViewer, scope: PasteScope): T[] {
    return pastes.filter((paste) => matchesScope(paste, viewer, scope));
}

// Public shape added to every listed paste so the dashboard can show ownership
// and distinguish the session's own pastes.
export function toAccessFields(paste: Paste, viewer: PasteViewer) {
    const email = viewer ? normalizeEmail(viewer.email) : '';
    return {
        owner: getOwner(paste),
        sharedWith: getSharedWith(paste),
        mine: !!email && getOwner(paste) === email,
        canEdit: canEdit(paste, viewer),
    };
}
