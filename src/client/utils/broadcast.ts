const CHANNEL_NAME = 'cleanbin-pastes';

export type PasteMessage =
  | { type: 'paste_created'; paste: { id: string; name?: string; permanent?: boolean; createdAt?: string } }
  | { type: 'paste_deleted'; id: string }
  | { type: 'paste_updated'; id: string }
  | { type: 'pastes_bulk_deleted'; ids: string[] }
  | { type: 'paste_touched'; id: string; expiresAt?: string };

export function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined' || !('BroadcastChannel' in window)) return null;
  try {
    return new BroadcastChannel(CHANNEL_NAME);
  } catch {
    return null;
  }
}

export function postBroadcast(msg: PasteMessage): void {
  const bc = getBroadcastChannel();
  if (!bc) return;
  try {
    bc.postMessage(msg);
    bc.close();
  } catch {
    // Best effort across tabs
  }
}

export function listenBroadcast(fn: (msg: PasteMessage) => void): () => void {
  const bc = getBroadcastChannel();
  if (!bc) return () => {};
  const handler = (ev: MessageEvent) => {
    try {
      fn(ev.data as PasteMessage);
    } catch {
      // Ignore malformed messages
    }
  };
  bc.addEventListener('message', handler);
  return () => {
    try {
      bc.removeEventListener('message', handler);
      bc.close();
    } catch {
      // Ignore close error
    }
  };
}
