// Zero-knowledge client-side AES-256-GCM encryption via native WebCrypto.
// The 256-bit key lives strictly in the URL fragment (#k=...) and never leaves the browser.

const E2EE_PREFIX = 'cb-e2ee:v1:';

interface DecryptedEnvelope {
  v: 1;
  name: string;
  content: string;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlToBytes(b64url: string): Uint8Array {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4);
  const binary = atob(padded);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

export function isEncryptedPasteContent(content: string): boolean {
  return typeof content === 'string' && content.startsWith(E2EE_PREFIX);
}

export async function encryptPastePayload(plain: {
  name: string;
  content: string;
}): Promise<{ payload: string; keyB64Url: string }> {
  const rawKey = new Uint8Array(32);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(rawKey);
  crypto.getRandomValues(iv);

  const cryptoKey = await crypto.subtle.importKey('raw', rawKey, { name: 'AES-GCM' }, false, ['encrypt']);
  const encoded = new TextEncoder().encode(
    JSON.stringify({ v: 1, name: plain.name, content: plain.content } satisfies DecryptedEnvelope)
  );
  const encryptedBuf = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, cryptoKey, encoded);

  const keyB64Url = bytesToBase64Url(rawKey);
  const ivB64Url = bytesToBase64Url(iv);
  const ctB64Url = bytesToBase64Url(new Uint8Array(encryptedBuf));

  return {
    payload: `${E2EE_PREFIX}${ivB64Url}.${ctB64Url}`,
    keyB64Url,
  };
}

export async function decryptPastePayload(
  payload: string,
  keyB64Url: string
): Promise<{ name: string; content: string }> {
  if (!isEncryptedPasteContent(payload)) {
    throw new Error('Payload is not an encrypted Cleanbin paste');
  }
  const rest = payload.slice(E2EE_PREFIX.length);
  const dotIdx = rest.indexOf('.');
  if (dotIdx <= 0) throw new Error('Malformed encrypted payload');

  const iv = base64UrlToBytes(rest.slice(0, dotIdx));
  const ciphertext = base64UrlToBytes(rest.slice(dotIdx + 1));
  const rawKey = base64UrlToBytes(keyB64Url.trim());
  if (rawKey.byteLength !== 32 || iv.byteLength !== 12) {
    throw new Error('Invalid decryption key length');
  }

  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey.buffer.slice(rawKey.byteOffset, rawKey.byteOffset + rawKey.byteLength) as ArrayBuffer,
    { name: 'AES-GCM' },
    false,
    ['decrypt']
  );
  const decryptedBuf = await crypto.subtle.decrypt(
    {
      name: 'AES-GCM',
      iv: iv.buffer.slice(iv.byteOffset, iv.byteOffset + iv.byteLength) as ArrayBuffer,
    },
    cryptoKey,
    ciphertext.buffer.slice(ciphertext.byteOffset, ciphertext.byteOffset + ciphertext.byteLength) as ArrayBuffer
  );

  const parsed = JSON.parse(new TextDecoder().decode(decryptedBuf)) as Partial<DecryptedEnvelope>;
  return {
    name: typeof parsed.name === 'string' ? parsed.name : '',
    content: typeof parsed.content === 'string' ? parsed.content : '',
  };
}
