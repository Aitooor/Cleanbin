import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { getConfig, type SqlEngineType } from '../config.js';

const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.unzip);

// Binary header tags for zero-Base64-overhead SQLite BLOB storage:
// 0x00 = raw UTF-8 bytes (used when uncompressed text is smaller than compressed output)
// 0x01 = Brotli-compressed stream
// 0x02 = Gzip-compressed stream
const BIN_TAG_RAW = 0x00;
const BIN_TAG_BROTLI = 0x01;
const BIN_TAG_GZIP = 0x02;

export interface CompactCompressedPayload {
  payload: string | Buffer;
  rawBytes: number;
  storedBytes: number;
}

export interface DecodedPayloadResult {
  content: string;
  isCompact: boolean;
  legacyMeta?: Record<string, unknown>;
}

// Compresses ONLY the paste text (no redundant JSON metadata wrapper) and picks
// whichever representation occupies the fewest bytes on disk.
// - On SQLite, binds raw binary Buffers directly (0% Base64 overhead).
// - On PostgreSQL / MySQL TEXT columns, uses compact prefix-tagged strings.
export async function compressContentCompact(
  content: string,
  dialect: SqlEngineType = 'sqlite'
): Promise<CompactCompressedPayload> {
  const { compression } = getConfig();
  const raw = Buffer.from(content, 'utf-8');
  const rawBytes = raw.length;

  if (dialect === 'sqlite') {
    const rawBlob = Buffer.concat([Buffer.from([BIN_TAG_RAW]), raw]);
    if (compression.type === 'none' || rawBytes <= 12) {
      return { payload: rawBlob, rawBytes, storedBytes: rawBlob.length };
    }

    if (compression.type === 'gzip') {
      const gz = await gzipAsync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });
      const gzBlob = Buffer.concat([Buffer.from([BIN_TAG_GZIP]), gz]);
      const chosen = gzBlob.length < rawBlob.length ? gzBlob : rawBlob;
      return { payload: chosen, rawBytes, storedBytes: chosen.length };
    }

    const compressed = await brotliCompressAsync(raw, {
      params: {
        [zlib.constants.BROTLI_PARAM_QUALITY]: compression.quality,
        [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
        [zlib.constants.BROTLI_PARAM_SIZE_HINT]: rawBytes,
      },
    });
    const brotliBlob = Buffer.concat([Buffer.from([BIN_TAG_BROTLI]), compressed]);
    const chosen = brotliBlob.length < rawBlob.length ? brotliBlob : rawBlob;
    return { payload: chosen, rawBytes, storedBytes: chosen.length };
  }

  // String-safe representation for PostgreSQL / MariaDB TEXT columns
  const rawTagged = `u0:${content}`;
  const rawTaggedBytes = Buffer.byteLength(rawTagged, 'utf-8');

  if (compression.type === 'none' || rawBytes <= 18) {
    return { payload: rawTagged, rawBytes, storedBytes: rawTaggedBytes };
  }

  if (compression.type === 'gzip') {
    const gz = await gzipAsync(raw, { level: zlib.constants.Z_BEST_COMPRESSION });
    const gzTagged = `gz:${gz.toString('base64')}`;
    const gzBytes = Buffer.byteLength(gzTagged, 'utf-8');
    return gzBytes < rawTaggedBytes
      ? { payload: gzTagged, rawBytes, storedBytes: gzBytes }
      : { payload: rawTagged, rawBytes, storedBytes: rawTaggedBytes };
  }

  const compressed = await brotliCompressAsync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: compression.quality,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: rawBytes,
    },
  });
  const b11Tagged = `b11:${compressed.toString('base64')}`;
  const b11Bytes = Buffer.byteLength(b11Tagged, 'utf-8');
  return b11Bytes < rawTaggedBytes
    ? { payload: b11Tagged, rawBytes, storedBytes: b11Bytes }
    : { payload: rawTagged, rawBytes, storedBytes: rawTaggedBytes };
}

// Decodes v2.2 binary BLOBs, v2.2 prefix-tagged strings (`u0:`, `b11:`, `gz:`),
// AND legacy v1/v2.0/v2.1 Base64 JSON payloads seamlessly.
export async function decompressRowContent(
  stored: string | Buffer | Uint8Array | null | undefined
): Promise<DecodedPayloadResult> {
  if (!stored) {
    return { content: '', isCompact: true };
  }

  if (Buffer.isBuffer(stored) || stored instanceof Uint8Array) {
    const buf = Buffer.isBuffer(stored) ? stored : Buffer.from(stored);
    if (buf.length === 0) return { content: '', isCompact: true };

    const tag = buf[0];
    if (tag === BIN_TAG_RAW) {
      return { content: buf.subarray(1).toString('utf-8'), isCompact: true };
    }
    if (tag === BIN_TAG_BROTLI) {
      const out = await brotliDecompressAsync(buf.subarray(1));
      return { content: out.toString('utf-8'), isCompact: true };
    }
    if (tag === BIN_TAG_GZIP) {
      const out = await gunzipAsync(buf.subarray(1));
      return { content: out.toString('utf-8'), isCompact: true };
    }

    const legacyJson = await decompressBufferAuto(buf);
    const parsed = JSON.parse(legacyJson) as Record<string, unknown>;
    return {
      content: typeof parsed.content === 'string' ? parsed.content : '',
      isCompact: false,
      legacyMeta: parsed,
    };
  }

  if (stored.startsWith('u0:')) {
    return { content: stored.slice(3), isCompact: true };
  }
  if (stored.startsWith('b11:')) {
    const out = await brotliDecompressAsync(Buffer.from(stored.slice(4), 'base64'));
    return { content: out.toString('utf-8'), isCompact: true };
  }
  if (stored.startsWith('gz:')) {
    const out = await gunzipAsync(Buffer.from(stored.slice(3), 'base64'));
    return { content: out.toString('utf-8'), isCompact: true };
  }

  const legacyText = await decompressPayload(stored);
  const parsed = JSON.parse(legacyText) as Record<string, unknown>;
  return {
    content: typeof parsed.content === 'string' ? parsed.content : '',
    isCompact: false,
    legacyMeta: parsed,
  };
}

export function measureStoredBytes(stored: string | Buffer | Uint8Array | null | undefined): number {
  if (!stored) return 0;
  if (Buffer.isBuffer(stored) || stored instanceof Uint8Array) return stored.byteLength;
  return Buffer.byteLength(stored, 'utf-8');
}

// Legacy helpers preserved for v1/v2.0 JSON migration and backward-compatibility tests.
export async function compressPayload(json: string): Promise<string> {
  const { compression } = getConfig();
  const raw = Buffer.from(json, 'utf-8');
  if (compression.type === 'none') {
    return raw.toString('base64');
  }
  if (compression.type === 'gzip') {
    const gz = await gzipAsync(raw);
    return gz.toString('base64');
  }
  const compressed = await brotliCompressAsync(raw, {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: compression.quality,
      [zlib.constants.BROTLI_PARAM_MODE]: zlib.constants.BROTLI_MODE_TEXT,
    },
  });
  return compressed.toString('base64');
}

export async function decompressPayload(encoded: string): Promise<string> {
  const buf = Buffer.from(encoded, 'base64');
  return decompressBufferAuto(buf);
}

export async function decompressBufferAuto(buf: Buffer): Promise<string> {
  if (buf.length === 0) return '{}';

  const first = buf[0];
  if (first === 0x7b || first === 0x20 || first === 0x0a || first === 0x0d) {
    try {
      const text = buf.toString('utf-8');
      JSON.parse(text);
      return text;
    } catch {
      // Fall through to decompression attempts
    }
  }

  if (buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b) {
    const unzipped = await gunzipAsync(buf);
    return unzipped.toString('utf-8');
  }

  try {
    const decompressed = await brotliDecompressAsync(buf);
    return decompressed.toString('utf-8');
  } catch {
    const unzipped = await gunzipAsync(buf);
    return unzipped.toString('utf-8');
  }
}
