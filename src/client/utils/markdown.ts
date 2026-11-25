import { marked } from 'marked';

const ALLOWED_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'br',
  'hr',
  'ul',
  'ol',
  'li',
  'blockquote',
  'pre',
  'code',
  'strong',
  'b',
  'em',
  'i',
  'del',
  's',
  'a',
  'table',
  'thead',
  'tbody',
  'tr',
  'th',
  'td',
  'input',
  'kbd',
  'sup',
  'sub',
  'details',
  'summary',
]);

const VOID_TAGS = new Set(['br', 'hr', 'input']);

const DROP_SUBTREE_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'form',
  'textarea',
  'title',
  'noscript',
  'template',
]);

function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function decodeBasicEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex) => {
      const cp = Number.parseInt(hex, 16);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&#([0-9]+);?/g, (_, dec) => {
      const cp = Number.parseInt(dec, 10);
      return Number.isFinite(cp) ? String.fromCodePoint(cp) : '';
    })
    .replace(/&colon;/gi, ':')
    .replace(/&tab;/gi, '')
    .replace(/&newline;/gi, '')
    .replace(/&amp;/gi, '&');
}

function isSafeHref(rawHref: string): boolean {
  const cleaned = decodeBasicEntities(rawHref)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0020]+/g, '')
    .trim();
  if (!cleaned) return false;
  if (cleaned.startsWith('#')) return true;
  if (cleaned.startsWith('/') && !cleaned.startsWith('//')) return true;
  return /^(https?:\/\/|mailto:)/i.test(cleaned);
}

function parseAttributes(rawAttrs: string): Map<string, string> {
  const attrs = new Map<string, string>();
  const attrRegex = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match: RegExpExecArray | null;
  while ((match = attrRegex.exec(rawAttrs)) !== null) {
    const attrName = match[1].toLowerCase();
    const attrVal = match[2] ?? match[3] ?? match[4] ?? '';
    attrs.set(attrName, attrVal);
  }
  return attrs;
}

// Strict zero-dependency HTML allowlist sanitizer that works identically in
// both browsers and Node (Vitest). Strips scripts, iframes, SVGs, event handlers,
// style attributes, external images/pixels, and unsafe URL schemes (`javascript:`, `data:`).
export function sanitizeMarkdownHtml(dirtyHtml: string): string {
  let cleaned = dirtyHtml.replace(/<!--[\s\S]*?-->/g, '');

  for (const blocked of DROP_SUBTREE_TAGS) {
    const blockRegex = new RegExp(`<${blocked}\\b[^>]*>[\\s\\S]*?<\\/${blocked}\\s*>`, 'gi');
    cleaned = cleaned.replace(blockRegex, '');
    const orphanRegex = new RegExp(`<\\/?${blocked}\\b[^>]*>`, 'gi');
    cleaned = cleaned.replace(orphanRegex, '');
  }

  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9:-]*)(\s[^<>]*?)?\s*\/?>/g;
  const openStack: string[] = [];
  let lastIdx = 0;
  let out = '';

  const escapeTextChunk = (chunk: string) =>
    chunk.replace(/</g, '&lt;').replace(/>/g, '&gt;');

  let match: RegExpExecArray | null;
  while ((match = tagRegex.exec(cleaned)) !== null) {
    out += escapeTextChunk(cleaned.slice(lastIdx, match.index));
    lastIdx = tagRegex.lastIndex;

    const full = match[0];
    const isClosing = full.startsWith('</');
    const tag = match[1].toLowerCase();
    const rawAttrs = match[2] ?? '';

    if (!ALLOWED_TAGS.has(tag)) {
      continue;
    }

    if (isClosing) {
      if (VOID_TAGS.has(tag)) continue;
      const pos = openStack.lastIndexOf(tag);
      if (pos !== -1) {
        while (openStack.length > pos) {
          const popped = openStack.pop()!;
          out += `</${popped}>`;
        }
      }
      continue;
    }

    const attrs = parseAttributes(rawAttrs);

    if (tag === 'input') {
      if ((attrs.get('type') || '').toLowerCase() !== 'checkbox') {
        continue;
      }
      const checked = attrs.has('checked') ? ' checked=""' : '';
      out += `<input type="checkbox" disabled=""${checked} />`;
      continue;
    }

    let safeAttrStr = '';
    if (tag === 'a') {
      const href = attrs.get('href') ?? '';
      if (isSafeHref(href)) {
        const external = /^https?:\/\//i.test(href.trim());
        safeAttrStr += ` href="${escapeAttr(href.trim())}" rel="noopener noreferrer"${
          external ? ' target="_blank"' : ''
        }`;
      }
      const title = attrs.get('title');
      if (title) safeAttrStr += ` title="${escapeAttr(title)}"`;
    } else if (tag === 'th' || tag === 'td') {
      const align = (attrs.get('align') || '').toLowerCase();
      if (align === 'left' || align === 'center' || align === 'right') {
        safeAttrStr += ` align="${align}"`;
      }
    } else if (tag === 'code') {
      const cls = attrs.get('class') || '';
      const langMatch = cls.match(/\blanguage-[a-z0-9_-]+\b/i);
      if (langMatch) {
        safeAttrStr += ` class="${escapeAttr(langMatch[0])}"`;
      }
    }

    if (VOID_TAGS.has(tag)) {
      out += `<${tag}${safeAttrStr} />`;
    } else {
      openStack.push(tag);
      out += `<${tag}${safeAttrStr}>`;
    }
  }

  out += escapeTextChunk(cleaned.slice(lastIdx));
  while (openStack.length > 0) {
    out += `</${openStack.pop()!}>`;
  }

  return out;
}

export function renderSafeMarkdown(markdownSource: string): string {
  const rawHtml = marked.parse(markdownSource, {
    async: false,
    gfm: true,
    breaks: true,
  }) as string;
  return sanitizeMarkdownHtml(rawHtml);
}
