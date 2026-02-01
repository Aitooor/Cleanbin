// Simple BroadcastChannel helper for notifying other tabs about paste changes.
const CHANNEL_NAME = 'cleanbin-pastes';

export function getBroadcastChannel(): BroadcastChannel | null {
  if (typeof window === 'undefined') return null;
  if (!('BroadcastChannel' in window)) return null;
  try {
    // @ts-ignore - TS may not recognize BroadcastChannel in some configs
    return new BroadcastChannel(CHANNEL_NAME);
  } catch (err) {
    return null;
  }
}

export type PasteMessage =
  | { type: 'paste_created'; paste: { id: string; name?: string; permanent?: boolean; createdAt?: string } }
  | { type: 'paste_deleted'; id: string }
  | { type: 'paste_renamed'; id: string; name: string }
  | { type: 'pastes_bulk_deleted'; ids: string[] };

export function postMessage(msg: PasteMessage) {
  const bc = getBroadcastChannel();
  if (!bc) return;
  try {
    bc.postMessage(msg);
  } catch (err) {
    // ignore
  }
}

export function listen(fn: (msg: PasteMessage) => void) {
  const bc = getBroadcastChannel();
  if (!bc) return () => {};
  const handler = (ev: MessageEvent) => {
    try {
      fn(ev.data as PasteMessage);
    } catch (err) {}
  };
  bc.addEventListener('message', handler);
  return () => {
    try {
      bc.removeEventListener('message', handler);
      bc.close();
    } catch (err) {}
  };
}

