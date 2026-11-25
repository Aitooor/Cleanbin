// Unified client-side fragment helper supporting both `#L10-L25` line ranges
// and `#k=<base64url>` zero-knowledge E2EE keys across BrowserRouter and HashRouter.

export interface LineRange {
  start: number;
  end: number;
}

export interface ParsedPasteFragment {
  key: string | null;
  lines: LineRange | null;
}

function parseLineToken(token: string): LineRange | null {
  const m = token.trim().match(/^L?(\d+)(?:-L?(\d+))?$/i);
  if (!m) return null;
  const a = Number.parseInt(m[1], 10);
  const b = m[2] ? Number.parseInt(m[2], 10) : a;
  if (!Number.isFinite(a) || !Number.isFinite(b) || a < 1 || b < 1) return null;
  return { start: Math.min(a, b), end: Math.max(a, b) };
}

export function formatLineToken(range: LineRange): string {
  return range.start === range.end ? `L${range.start}` : `L${range.start}-L${range.end}`;
}

export function parsePasteFragment(rawHash: string, searchParams?: URLSearchParams): ParsedPasteFragment {
  let key: string | null = searchParams?.get('k') || null;
  let lines: LineRange | null = null;

  const searchLine = searchParams?.get('L') || searchParams?.get('l');
  if (searchLine) {
    lines = parseLineToken(searchLine);
  }

  const cleaned = rawHash.replace(/^#/, '').trim();
  if (cleaned) {
    // Ignore HashRouter route path prefix like `/id?...` if raw window.location.hash was passed
    const hashBody = cleaned.startsWith('/') ? '' : cleaned;
    if (hashBody) {
      for (const part of hashBody.split('&')) {
        const piece = part.trim();
        if (!piece) continue;
        if (piece.startsWith('k=')) {
          key = decodeURIComponent(piece.slice(2));
        } else if (/^L\d+(?:-L?\d+)?$/i.test(piece)) {
          lines = parseLineToken(piece);
        } else if (piece.startsWith('L=') || piece.startsWith('l=')) {
          lines = parseLineToken(piece.slice(2));
        }
      }
    }
  }

  return { key, lines };
}

export function buildPasteTarget(
  id: string,
  opts: { key?: string | null; lines?: LineRange | null; demoMode?: boolean }
): { routePath: string; fullShareUrl: string } {
  const isDemo = opts.demoMode ?? import.meta.env.VITE_DEMO_MODE === '1';
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const baseUrl = import.meta.env.BASE_URL || '/';

  if (isDemo) {
    const qs = new URLSearchParams();
    if (opts.key) qs.set('k', opts.key);
    if (opts.lines) qs.set('L', formatLineToken(opts.lines));
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const routePath = `/${id}${suffix}`;
    return {
      routePath,
      fullShareUrl: `${origin}${baseUrl}#${routePath}`,
    };
  }

  const hashParts: string[] = [];
  if (opts.key) hashParts.push(`k=${encodeURIComponent(opts.key)}`);
  if (opts.lines) hashParts.push(formatLineToken(opts.lines));
  const hashSuffix = hashParts.length > 0 ? `#${hashParts.join('&')}` : '';
  const routePath = `/${id}${hashSuffix}`;
  return {
    routePath,
    fullShareUrl: `${origin}${routePath}`,
  };
}
