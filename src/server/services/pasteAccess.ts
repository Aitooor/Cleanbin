import { normalizeEmail } from '../../shared/validation.js';
import type { PasteScope, SessionRole } from '../../shared/types.js';

export interface PasteAccessSubject {
  owner?: string | null;
  sharedWith?: string[];
}

export type PasteViewer = { email: string; role: SessionRole } | null;

export function getOwner(paste: PasteAccessSubject): string | null {
  return typeof paste.owner === 'string' && paste.owner.trim() ? normalizeEmail(paste.owner) : null;
}

export function getSharedWith(paste: PasteAccessSubject): string[] {
  if (!Array.isArray(paste.sharedWith)) return [];
  return paste.sharedWith.map((email) => normalizeEmail(email)).filter(Boolean);
}

export function isOwner(paste: PasteAccessSubject, email: string | null | undefined): boolean {
  const owner = getOwner(paste);
  return owner !== null && owner === normalizeEmail(email);
}

export function isAdmin(viewer: PasteViewer): boolean {
  return viewer?.role === 'admin';
}

export function canEdit(paste: PasteAccessSubject, viewer: PasteViewer): boolean {
  if (!viewer) return false;
  if (isAdmin(viewer)) return true;
  const email = normalizeEmail(viewer.email);
  return getOwner(paste) === email || getSharedWith(paste).includes(email);
}

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

export function matchesScope(paste: PasteAccessSubject, viewer: PasteViewer, scope: PasteScope): boolean {
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
  return owner === email || getSharedWith(paste).includes(email);
}

export function selectVisible<T extends PasteAccessSubject>(
  pastes: T[],
  viewer: PasteViewer,
  scope: PasteScope
): T[] {
  return pastes.filter((paste) => matchesScope(paste, viewer, scope));
}

export function toAccessFields(paste: PasteAccessSubject, viewer: PasteViewer) {
  const email = viewer ? normalizeEmail(viewer.email) : '';
  return {
    owner: getOwner(paste),
    sharedWith: getSharedWith(paste),
    mine: !!email && getOwner(paste) === email,
    canEdit: canEdit(paste, viewer),
  };
}
