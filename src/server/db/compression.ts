import { promisify } from 'node:util';
import zlib from 'node:zlib';
import { getConfig } from '../config.js';

const brotliCompressAsync = promisify(zlib.brotliCompress);
const brotliDecompressAsync = promisify(zlib.brotliDecompress);
const gzipAsync = promisify(zlib.gzip);
const gunzipAsync = promisify(zlib.unzip);

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
    params: { [zlib.constants.BROTLI_PARAM_QUALITY]: compression.quality },
  });
  return compressed.toString('base64');
}

// Decodes base64 payloads written with brotli, gzip, or uncompressed UTF-8 so
// changing COMPRESSION_TYPE never breaks reading older rows.
export async function decompressPayload(encoded: string): Promise<string> {
  const buf = Buffer.from(encoded, 'base64');
  return decompressBufferAuto(buf);
}

export async function decompressBufferAuto(buf: Buffer): Promise<string> {
  if (buf.length === 0) return '{}';

  // Plain JSON starts with '{' (0x7b) or whitespace
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

  // Gzip magic header: 0x1f 0x8b
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
