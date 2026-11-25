import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  FiClipboard,
  FiCode,
  FiCopy,
  FiDownload,
  FiEye,
  FiEyeOff,
  FiFilePlus,
  FiFileText,
  FiLock,
  FiSliders,
} from 'react-icons/fi';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css';
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import sql from 'highlight.js/lib/languages/sql';
import yaml from 'highlight.js/lib/languages/yaml';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import xml from 'highlight.js/lib/languages/xml';
import css from 'highlight.js/lib/languages/css';
import cLang from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import markdown from 'highlight.js/lib/languages/markdown';
import diff from 'highlight.js/lib/languages/diff';
import ini from 'highlight.js/lib/languages/ini';
import { useNotification } from '../components/NotificationProvider';
import { listenBroadcast, postBroadcast } from '../utils/broadcast';
import { decryptPastePayload, isEncryptedPasteContent } from '../utils/e2ee';
import { renderSafeMarkdown } from '../utils/markdown';
import { buildPasteTarget, parsePasteFragment, type LineRange } from '../utils/urlHash';
import type { PasteTtlOption, PasteVisibility } from '../../shared/types';

const LANGUAGES: Array<[string, Parameters<typeof hljs.registerLanguage>[1]]> = [
  ['javascript', javascript],
  ['typescript', typescript],
  ['python', python],
  ['bash', bash],
  ['json', json],
  ['java', java],
  ['kotlin', kotlin],
  ['sql', sql],
  ['yaml', yaml],
  ['dockerfile', dockerfile],
  ['rust', rust],
  ['go', go],
  ['xml', xml],
  ['css', css],
  ['c', cLang],
  ['cpp', cpp],
  ['csharp', csharp],
  ['markdown', markdown],
  ['diff', diff],
  ['ini', ini],
];

for (const [langName, def] of LANGUAGES) {
  hljs.registerLanguage(langName, def);
}

const LANGUAGE_NAMES = LANGUAGES.map(([n]) => n);

const EXT_BY_LANGUAGE: Record<string, string> = {
  javascript: 'js',
  typescript: 'ts',
  python: 'py',
  bash: 'sh',
  json: 'json',
  java: 'java',
  kotlin: 'kt',
  sql: 'sql',
  yaml: 'yaml',
  dockerfile: 'Dockerfile',
  rust: 'rs',
  go: 'go',
  xml: 'html',
  css: 'css',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  markdown: 'md',
  diff: 'diff',
  ini: 'ini',
  plaintext: 'txt',
};

function buildDownloadFilename(rawName: string, fallbackId: string, lang: string): string {
  const baseRaw = (rawName || fallbackId || 'paste').split('\n')[0].trim();
  const safeBase = baseRaw
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'paste';

  if (/\.[a-z0-9]{1,10}$/i.test(safeBase)) {
    return safeBase;
  }
  const ext = EXT_BY_LANGUAGE[lang] || 'txt';
  if (ext === 'Dockerfile') {
    return safeBase === 'paste' ? 'Dockerfile' : `${safeBase}.dockerfile`;
  }
  return `${safeBase}.${ext}`;
}

// Splits highlight.js HTML output by newline while balancing open `<span>` tags
// so multi-line strings/comments keep their syntax color across numbered rows.
function splitHighlightedHtmlByLine(html: string): string[] {
  const rawLines = html.split('\n');
  const openTags: string[] = [];
  const out: string[] = [];
  const tagRegex = /<\/?span[^>]*>/g;

  for (const raw of rawLines) {
    const prefix = openTags.join('');
    let match: RegExpExecArray | null;
    tagRegex.lastIndex = 0;
    while ((match = tagRegex.exec(raw)) !== null) {
      const tag = match[0];
      if (tag.startsWith('</')) {
        openTags.pop();
      } else if (!tag.endsWith('/>')) {
        openTags.push(tag);
      }
    }
    const suffix = '</span>'.repeat(openTags.length);
    out.push(prefix + raw + suffix);
  }

  return out;
}

const actionBtnStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  color: '#b0b0b0',
  border: '1px solid #333',
  borderRadius: '4px',
  padding: '8px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease',
};

interface UnburnedRouterState {
  unburnedPreview?: {
    content: string;
    name: string;
    encrypted: boolean;
  };
}

export default function PasteViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const { addNotification } = useNotification();

  const [rawServerContent, setRawServerContent] = useState<string | null>(null);
  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [visibility, setVisibility] = useState<PasteVisibility>('public');
  const [burnAfterRead, setBurnAfterRead] = useState(false);
  const [burned, setBurned] = useState(false);
  const [canManageState, setCanManageState] = useState(false);
  const [showStateBar, setShowStateBar] = useState(false);
  const [stateTtl, setStateTtl] = useState<'' | PasteTtlOption>('');
  const [stateName, setStateName] = useState('');
  const [stateBusy, setStateBusy] = useState(false);
  const [unopenedBurnPreview, setUnopenedBurnPreview] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timeLeftLabel, setTimeLeftLabel] = useState<string | null>(null);
  const [showImports, setShowImports] = useState(false);
  const [langOverride, setLangOverride] = useState<string>('auto');
  const [markdownPreview, setMarkdownPreview] = useState(false);

  const [isEncrypted, setIsEncrypted] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [manualKey, setManualKey] = useState('');
  const [activeKey, setActiveKey] = useState<string | null>(null);

  const [selectedLines, setSelectedLines] = useState<LineRange | null>(null);
  const scrolledOnceRef = useRef(false);

  // Sync URL hash (#k=... & #L10-L25)
  useEffect(() => {
    const syncFromUrl = () => {
      const parsed = parsePasteFragment(window.location.hash, searchParams);
      if (parsed.key) setActiveKey(parsed.key);
      setSelectedLines(parsed.lines);
    };
    syncFromUrl();
    window.addEventListener('hashchange', syncFromUrl);
    return () => window.removeEventListener('hashchange', syncFromUrl);
  }, [location.hash, searchParams]);

  // Load paste (or render author's unburned preview without consuming the 1 read)
  useEffect(() => {
    if (!id) return;
    scrolledOnceRef.current = false;
    setMarkdownPreview(false);

    const routerState = (location.state ?? null) as UnburnedRouterState | null;
    if (routerState?.unburnedPreview) {
      setContent(routerState.unburnedPreview.content);
      setName(routerState.unburnedPreview.name);
      setIsEncrypted(routerState.unburnedPreview.encrypted);
      setBurnAfterRead(true);
      setBurned(false);
      setUnopenedBurnPreview(true);
      setRawServerContent(null);
      setNeedsKey(false);
      return;
    }

    setUnopenedBurnPreview(false);
    let active = true;
    fetch(`/api/paste/${encodeURIComponent(id)}?touch=1`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        const fetchedContent = typeof data.content === 'string' ? data.content : 'Failed to load paste.';
        const fetchedName = typeof data.name === 'string' ? data.name : '';
        const isPerm = data.permanent === true || data.permanent === 'true';
        const isBurn = Boolean(data.burnAfterRead);
        setPermanent(isPerm);
        setVisibility(data.visibility === 'private' ? 'private' : 'public');
        setBurnAfterRead(isBurn);
        setBurned(Boolean(data.burned));
        setCanManageState(Boolean(data.canManageState));
        setShowStateBar(false);
        setStateName(fetchedName);
        setStateTtl(isPerm ? 'permanent' : isBurn ? 'burn' : '');

        if (isEncryptedPasteContent(fetchedContent)) {
          setIsEncrypted(true);
          setRawServerContent(fetchedContent);
        } else {
          setIsEncrypted(false);
          setRawServerContent(null);
          setNeedsKey(false);
          setContent(fetchedContent);
          setName(fetchedName);
        }

        if (data && typeof data.expiresAt === 'string') {
          setExpiresAt(data.expiresAt);
          postBroadcast({ type: 'paste_touched', id, expiresAt: data.expiresAt });
        } else {
          setExpiresAt(null);
        }
      })
      .catch(() => {
        if (active) {
          setRawServerContent(null);
          setIsEncrypted(false);
          setNeedsKey(false);
          setContent('Paste not found or already burned.');
        }
      });

    return () => {
      active = false;
    };
  }, [id, location.state]);

  // Decrypt client-side whenever an E2EE payload + key are available
  useEffect(() => {
    if (!rawServerContent) return;
    const parsedFrag = parsePasteFragment(window.location.hash, searchParams);
    const candidateKey = activeKey || parsedFrag.key;
    if (!candidateKey) {
      setNeedsKey(true);
      return;
    }

    let cancelled = false;
    decryptPastePayload(rawServerContent, candidateKey)
      .then((decrypted) => {
        if (cancelled) return;
        setContent(decrypted.content);
        setName(decrypted.name);
        setNeedsKey(false);
      })
      .catch(() => {
        if (!cancelled) setNeedsKey(true);
      });

    return () => {
      cancelled = true;
    };
  }, [rawServerContent, activeKey, searchParams]);

  useEffect(() => {
    if (!id) return;
    return listenBroadcast((msg) => {
      if (msg?.type === 'paste_touched' && msg.id === id && msg.expiresAt) {
        setExpiresAt(msg.expiresAt);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!expiresAt || permanent || burnAfterRead) {
      setTimeLeftLabel(null);
      return;
    }

    const updateLabel = () => {
      const target = new Date(expiresAt).getTime();
      if (!target || Number.isNaN(target)) {
        setTimeLeftLabel(null);
        return;
      }
      const diffMs = target - Date.now();
      if (diffMs <= 0) {
        setTimeLeftLabel('Deleting soon');
        return;
      }
      const totalSeconds = Math.floor(diffMs / 1000);
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      const parts: string[] = [];
      if (days > 0) parts.push(`${days}d`);
      if (hours > 0 || days > 0) parts.push(`${hours}h`);
      if (minutes > 0 || hours > 0 || days > 0) parts.push(`${minutes}m`);
      parts.push(`${seconds}s`);

      setTimeLeftLabel(`Deleting in: ${parts.join(' ')}`);
    };

    updateLabel();
    const intervalId = window.setInterval(updateLabel, 1000);
    return () => window.clearInterval(intervalId);
  }, [expiresAt, permanent, burnAfterRead]);

  const parsedHighlight = useMemo(() => {
    if (!content) {
      return {
        detectedLang: 'plaintext',
        linesHtml: [] as string[],
        importStart: -1,
        importEnd: -1,
        importCount: 0,
      };
    }

    const normalizedContent = content.replace(/\r\n?/g, '\n');
    const rawLines = normalizedContent.split('\n');
    let detectedLang = 'plaintext';
    let fullHtml = '';

    if (langOverride === 'plaintext') {
      detectedLang = 'plaintext';
      fullHtml = normalizedContent
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    } else if (langOverride !== 'auto' && hljs.getLanguage(langOverride)) {
      const res = hljs.highlight(normalizedContent, { language: langOverride, ignoreIllegals: true });
      detectedLang = langOverride;
      fullHtml = res.value;
    } else {
      const res = hljs.highlightAuto(normalizedContent);
      detectedLang = res.language || 'plaintext';
      fullHtml = res.value;
    }

    const linesHtml = splitHighlightedHtmlByLine(fullHtml);

    let importStart = -1;
    let importEnd = -1;
    let importCount = 0;
    const isImportLine = (line: string) => /^(\s*)import(\s+type|\s+static|\s+)/.test(line);
    const isBlankOrComment = (line: string) => /^(\s*$|\s*\/\/.*$)/.test(line);

    for (let i = 0; i < rawLines.length; i += 1) {
      const line = rawLines[i];
      if (importStart === -1) {
        if (isImportLine(line)) {
          importStart = i;
          importEnd = i;
          importCount = 1;
        }
      } else if (isImportLine(line)) {
        importEnd = i;
        importCount += 1;
      } else if (isBlankOrComment(line)) {
        importEnd = i;
      } else {
        break;
      }
    }

    if (importCount < 2) {
      importStart = -1;
      importEnd = -1;
    }

    return {
      detectedLang,
      linesHtml,
      importStart,
      importEnd,
      importCount,
    };
  }, [content, langOverride]);

  const isMarkdownCapable = useMemo(() => {
    if (!content) return false;
    if (langOverride === 'markdown') return true;
    if (langOverride === 'auto' && parsedHighlight.detectedLang === 'markdown') return true;
    return /\.(md|markdown)$/i.test(name.trim());
  }, [content, langOverride, parsedHighlight.detectedLang, name]);

  const renderedMarkdownHtml = useMemo(() => {
    if (!markdownPreview || !content) return '';
    return renderSafeMarkdown(content);
  }, [markdownPreview, content]);

  // If URL specifies a line inside collapsed imports, auto-expand imports and scroll into view
  useEffect(() => {
    if (markdownPreview || !selectedLines || parsedHighlight.linesHtml.length === 0) return;
    if (
      !showImports &&
      parsedHighlight.importStart >= 0 &&
      selectedLines.start <= parsedHighlight.importEnd + 1 &&
      selectedLines.end >= parsedHighlight.importStart + 1
    ) {
      setShowImports(true);
      return;
    }
    if (!scrolledOnceRef.current) {
      const rowEl = document.getElementById(`cb-line-${selectedLines.start}`);
      if (rowEl) {
        scrolledOnceRef.current = true;
        rowEl.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }
    }
  }, [selectedLines, parsedHighlight, showImports, markdownPreview]);

  const nameHtml = useMemo(() => {
    if (!name) return '';
    const HR_PLACEHOLDER = '\u0001HR\u0001';
    const hrHtml =
      '<hr style="margin:6px 0;border:none;border-top:1px solid rgba(255,255,255,0.25);" />';
    return name
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<hr\s*\/?>/gi, HR_PLACEHOLDER)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br />')
      .split(HR_PLACEHOLDER)
      .join(hrHtml);
  }, [name]);

  const handleLineClick = (lineNumber: number, shiftKey: boolean) => {
    if (!id) return;
    const nextRange: LineRange =
      shiftKey && selectedLines
        ? {
            start: Math.min(selectedLines.start, lineNumber),
            end: Math.max(selectedLines.start, lineNumber),
          }
        : { start: lineNumber, end: lineNumber };

    setSelectedLines(nextRange);
    const target = buildPasteTarget(id, { key: activeKey, lines: nextRange });
    if (import.meta.env.VITE_DEMO_MODE === '1') {
      navigate(target.routePath, { replace: true, state: location.state });
    } else {
      window.history.replaceState(window.history.state, '', target.routePath);
    }
  };

  const handleCopyCode = () => {
    if (!content) return;
    navigator.clipboard?.writeText(content).then(
      () => addNotification('Code copied to clipboard'),
      () => addNotification('Could not copy code')
    );
  };

  const handleOpenRaw = () => {
    if (!id) return;
    if (isEncrypted || burnAfterRead || import.meta.env.VITE_DEMO_MODE === '1') {
      const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
      const blobUrl = URL.createObjectURL(blob);
      window.open(blobUrl, '_blank', 'noopener,noreferrer');
      return;
    }
    window.open(`/raw/${encodeURIComponent(id)}`, '_blank', 'noopener,noreferrer');
  };

  const handleDownload = () => {
    if (!content) return;
    const filename = buildDownloadFilename(name, id || 'paste', parsedHighlight.detectedLang);
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const blobUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = blobUrl;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  const handleClone = () => {
    if (!id) return;
    navigate(`/clone/${encodeURIComponent(id)}`, {
      state: { clonedContent: content, clonedName: name },
    });
  };

  const handleStatePatch = async (patch: { visibility?: PasteVisibility; ttl?: PasteTtlOption }) => {
    if (!id || stateBusy || !canManageState) return;
    const effectiveName = stateName.trim() || name.trim();
    if (patch.ttl === 'permanent' && !effectiveName && !isEncrypted) {
      addNotification('Enter a name first before switching to Permanent.');
      return;
    }

    setStateBusy(true);
    try {
      const payload: Record<string, unknown> = { ...patch };
      if (isEncrypted && patch.ttl === 'permanent') {
        // Keep the decrypted title private inside the E2EE payload; send generic label for server perm validation.
        payload.name = 'Encrypted paste';
      } else if (stateName.trim() && stateName.trim() !== name.trim()) {
        payload.name = stateName.trim();
      }
      const res = await fetch(`/api/paste/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        addNotification(data.message || data.error || 'Could not update paste state.');
        return;
      }
      const saved = data.paste;
      if (saved) {
        setName(saved.name ?? '');
        setStateName(saved.name ?? '');
        setPermanent(Boolean(saved.permanent));
        setVisibility(saved.visibility === 'private' ? 'private' : 'public');
        setBurnAfterRead(Boolean(saved.burnAfterRead));
        setExpiresAt(typeof saved.expiresAt === 'string' ? saved.expiresAt : null);
        if (saved.permanent) setStateTtl('permanent');
        else if (saved.burnAfterRead) setStateTtl('burn');
        else if (patch.ttl) setStateTtl(patch.ttl);
      }
      postBroadcast({ type: 'paste_updated', id });
      addNotification('Paste state updated.');
    } finally {
      setStateBusy(false);
    }
  };

  const renderNumberedLines = () => {
    const { linesHtml, importStart, importEnd, importCount } = parsedHighlight;
    const elements: React.ReactNode[] = [];

    for (let idx = 0; idx < linesHtml.length; idx += 1) {
      const lineNo = idx + 1;

      if (!showImports && importStart >= 0 && idx >= importStart && idx <= importEnd) {
        if (idx === importStart) {
          elements.push(
            <div
              key={`imports-collapsed-${lineNo}`}
              id={`cb-line-${lineNo}`}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                padding: '0 8px',
                borderRadius: 2,
                cursor: 'pointer',
              }}
              onClick={() => setShowImports(true)}
            >
              <span
                style={{
                  width: '3.5ch',
                  marginRight: 14,
                  textAlign: 'right',
                  color: '#555',
                  userSelect: 'none',
                  flexShrink: 0,
                  fontSize: '0.88em',
                }}
              >
                {lineNo}
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ color: '#90caf9', marginRight: 6, userSelect: 'none' }}>▶</span>
                <span dangerouslySetInnerHTML={{ __html: linesHtml[idx] }} />
                <span style={{ color: '#666', fontSize: '0.85em', marginLeft: 8, userSelect: 'none' }}>
                  ({importCount} imports)
                </span>
              </span>
            </div>
          );
        }
        continue;
      }

      const isSelected =
        selectedLines !== null && lineNo >= selectedLines.start && lineNo <= selectedLines.end;
      const isExpandedFirstImport = showImports && importStart >= 0 && idx === importStart;

      elements.push(
        <div
          key={lineNo}
          id={`cb-line-${lineNo}`}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            padding: '0 8px',
            backgroundColor: isSelected ? 'rgba(255, 255, 255, 0.065)' : 'transparent',
            borderLeft: isSelected ? '2px solid #888' : '2px solid transparent',
          }}
        >
          <span
            onClick={(e) => handleLineClick(lineNo, e.shiftKey)}
            title="Click to link line (Shift+Click for range)"
            style={{
              width: '3.5ch',
              marginRight: 14,
              textAlign: 'right',
              color: isSelected ? '#cfcfcf' : '#555',
              userSelect: 'none',
              cursor: 'pointer',
              flexShrink: 0,
              fontSize: '0.88em',
            }}
          >
            {lineNo}
          </span>
          <span style={{ flex: 1, minWidth: 0 }}>
            {isExpandedFirstImport && (
              <span
                onClick={() => setShowImports(false)}
                title="Collapse imports"
                style={{
                  color: '#90caf9',
                  marginRight: 6,
                  cursor: 'pointer',
                  display: 'inline-block',
                  transform: 'rotate(90deg)',
                  userSelect: 'none',
                }}
              >
                ▶
              </span>
            )}
            <span
              dangerouslySetInnerHTML={{
                __html: linesHtml[idx] || '&#8203;',
              }}
            />
          </span>
        </div>
      );
    }

    return elements;
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        height: '100vh',
        width: '100vw',
        background: '#1e1e1e',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          alignSelf: 'flex-end',
          margin: '12px 12px 0 12px',
          maxWidth: 420,
          padding: 8,
          background: 'rgba(34, 34, 34, 0.94)',
          border: '1px solid #333',
          borderRadius: 6,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          flexShrink: 0,
        }}
      >
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', justifyContent: 'flex-end' }}>
          {visibility === 'private' && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#ffb74d',
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
              }}
              title="Private paste: accessible only to owner, collaborators, and admins"
            >
              <FiEyeOff size={11} /> Private
            </span>
          )}
          {isEncrypted && (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 11,
                color: '#90ee90',
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
              }}
              title="Decrypted locally in browser via AES-256-GCM"
            >
              <FiLock size={11} /> E2EE
            </span>
          )}
          {unopenedBurnPreview && (
            <span style={{ fontSize: 11, color: '#ffb74d', whiteSpace: 'nowrap' }}>
              1 read · ready (unopened)
            </span>
          )}
          {!unopenedBurnPreview && burned && (
            <span style={{ fontSize: 11, color: '#e07a7a', whiteSpace: 'nowrap' }}>
              Burned · deleted from server
            </span>
          )}
          {!permanent && !burnAfterRead && timeLeftLabel && (
            <span style={{ fontSize: 11, color: '#ffb74d', whiteSpace: 'nowrap' }}>
              {timeLeftLabel}
            </span>
          )}
        </div>

        {name && (
          <div
            title={name || 'Untitled'}
            style={{
              maxWidth: 380,
              fontSize: 13,
              color: '#b0b0b0',
              fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
              textAlign: 'right',
              overflow: 'hidden',
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-word',
            }}
            dangerouslySetInnerHTML={{ __html: nameHtml }}
          />
        )}

        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {!needsKey && content && (
            <select
              aria-label="Syntax highlight language"
              title="Syntax language"
              value={langOverride}
              onChange={(e) => {
                setLangOverride(e.target.value);
                if (e.target.value !== 'markdown' && e.target.value !== 'auto') {
                  setMarkdownPreview(false);
                }
              }}
              style={{
                width: 'auto',
                height: 34,
                marginBottom: 0,
                padding: '0 8px',
                backgroundColor: '#1e1e1e',
                color: '#888',
                border: '1px solid #333',
                borderRadius: 4,
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                fontSize: 11,
                cursor: 'pointer',
              }}
            >
              <option value="auto">auto · {parsedHighlight.detectedLang}</option>
              <option value="plaintext">plaintext</option>
              {LANGUAGE_NAMES.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          )}

          {!needsKey && isMarkdownCapable && (
            <button
              type="button"
              onClick={() => setMarkdownPreview((v) => !v)}
              title={markdownPreview ? 'View source code' : 'Preview Markdown'}
              aria-label={markdownPreview ? 'View source code' : 'Preview Markdown'}
              style={{
                ...actionBtnStyle,
                height: 34,
                padding: '0 9px',
                gap: 5,
                fontSize: 11,
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                color: markdownPreview ? '#e0e0e0' : '#b0b0b0',
                borderColor: markdownPreview ? '#4f4f4f' : '#333',
                backgroundColor: markdownPreview ? '#282828' : '#1e1e1e',
              }}
            >
              {markdownPreview ? <FiCode size={14} /> : <FiEye size={14} />}
              <span>{markdownPreview ? 'Code' : 'Preview'}</span>
            </button>
          )}

          {!needsKey && content && (
            <>
              <button
                type="button"
                onClick={handleCopyCode}
                title="Copy code"
                aria-label="Copy code"
                style={actionBtnStyle}
              >
                <FiClipboard size={17} />
              </button>
              <button
                type="button"
                onClick={handleOpenRaw}
                title="Raw text"
                aria-label="Open raw text"
                style={actionBtnStyle}
              >
                <FiFileText size={17} />
              </button>
              <button
                type="button"
                onClick={handleDownload}
                title="Download file"
                aria-label="Download file"
                style={actionBtnStyle}
              >
                <FiDownload size={17} />
              </button>
              <button
                type="button"
                onClick={handleClone}
                title="Clone paste"
                aria-label="Clone paste"
                style={actionBtnStyle}
              >
                <FiCopy size={17} />
              </button>
              {canManageState && !unopenedBurnPreview && (
                <button
                  type="button"
                  onClick={() => setShowStateBar((v) => !v)}
                  title="Change paste state (visibility / expiration)"
                  aria-label="Change paste state"
                  style={{
                    ...actionBtnStyle,
                    color: showStateBar ? '#e0e0e0' : '#b0b0b0',
                    borderColor: showStateBar ? '#555' : '#333',
                    backgroundColor: showStateBar ? '#282828' : '#1e1e1e',
                  }}
                >
                  <FiSliders size={16} />
                </button>
              )}
            </>
          )}

          <button
            type="button"
            onClick={() => navigate('/')}
            title="New paste"
            aria-label="New paste"
            style={actionBtnStyle}
          >
            <FiFilePlus size={17} />
          </button>
        </div>

        {showStateBar && canManageState && !needsKey && (
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              gap: 6,
              alignItems: 'center',
              justifyContent: 'flex-end',
              paddingTop: 6,
              borderTop: '1px solid #2c2c2c',
              width: '100%',
            }}
          >
            {!name && (
              <input
                type="text"
                placeholder="name (if permanent)"
                value={stateName}
                onChange={(e) => setStateName(e.target.value)}
                style={{
                  width: 140,
                  height: 30,
                  marginBottom: 0,
                  padding: '0 8px',
                  backgroundColor: '#1a1a1a',
                  color: '#e0e0e0',
                  border: '1px solid #333',
                  borderRadius: 4,
                  fontSize: 11,
                  fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                }}
              />
            )}
            <select
              aria-label="Paste visibility"
              disabled={stateBusy}
              value={visibility}
              onChange={(e) => void handleStatePatch({ visibility: e.target.value as PasteVisibility })}
              style={{
                width: 'auto',
                height: 30,
                marginBottom: 0,
                padding: '0 8px',
                backgroundColor: '#1a1a1a',
                color: visibility === 'private' ? '#ffb74d' : '#b0b0b0',
                border: '1px solid #333',
                borderRadius: 4,
                fontSize: 11,
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                cursor: 'pointer',
              }}
            >
              <option value="public">public</option>
              <option value="private">private</option>
            </select>
            <select
              aria-label="Paste lifecycle"
              disabled={stateBusy}
              value={stateTtl}
              onChange={(e) => {
                const nextTtl = e.target.value as PasteTtlOption | '';
                if (!nextTtl) return;
                void handleStatePatch({ ttl: nextTtl });
              }}
              style={{
                width: 'auto',
                height: 30,
                marginBottom: 0,
                padding: '0 8px',
                backgroundColor: '#1a1a1a',
                color: permanent ? '#90ee90' : '#b0b0b0',
                border: '1px solid #333',
                borderRadius: 4,
                fontSize: 11,
                fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                cursor: 'pointer',
              }}
            >
              <option value="">{permanent ? 'permanent' : burnAfterRead ? '1 read' : 'keep expiry'}</option>
              <option value="30d">30d</option>
              <option value="7d">7d</option>
              <option value="24h">24h</option>
              <option value="1h">1h</option>
              <option value="burn">1 read</option>
              <option value="permanent">permanent</option>
            </select>
          </div>
        )}
      </div>

      {needsKey ? (
        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
            fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
          }}
        >
          <div
            style={{
              width: '100%',
              maxWidth: 380,
              padding: 20,
              background: '#1e1e1e',
              border: '1px solid #333',
              borderRadius: 4,
            }}
          >
            <div style={{ fontSize: 14, fontWeight: 600, color: '#e0e0e0', marginBottom: 6 }}>
              encrypted paste
            </div>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              This paste is end-to-end encrypted. Enter the decryption key from the URL fragment to view it.
            </p>
            <input
              type="password"
              placeholder="paste decryption key"
              value={manualKey}
              onChange={(e) => setManualKey(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && manualKey.trim()) {
                  setActiveKey(manualKey.trim());
                }
              }}
              style={{ marginBottom: 10, fontFamily: 'inherit', fontSize: 12 }}
            />
            <button
              type="button"
              onClick={() => {
                if (manualKey.trim()) setActiveKey(manualKey.trim());
              }}
              className="login-secondary-button"
              style={{
                width: '100%',
                background: '#282828',
                color: '#e0e0e0',
                border: '1px solid #444',
                borderRadius: 4,
                padding: '8px 12px',
                fontFamily: 'inherit',
                fontSize: 12,
                fontWeight: 600,
              }}
            >
              decrypt in browser
            </button>
          </div>
        </div>
      ) : markdownPreview ? (
        <div
          style={{
            width: '100vw',
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'stretch',
            overflow: 'hidden',
          }}
        >
          <div
            className="cb-md"
            dangerouslySetInnerHTML={{ __html: renderedMarkdownHtml }}
          />
        </div>
      ) : (
        <div
          style={{
            width: '100vw',
            flex: 1,
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'stretch',
            overflow: 'hidden',
          }}
        >
          <pre
            className={`hljs ${parsedHighlight.detectedLang}`}
            style={{
              width: '100vw',
              height: '100%',
              margin: 0,
              padding: '10px 5vw 18px 4vw',
              fontSize: 'clamp(11px, 2vw, 14px)',
              lineHeight: 1.75,
              fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
              color: '#e0e0e0',
              background: 'none',
              borderRadius: 0,
              overflow: 'auto',
              boxSizing: 'border-box',
              outline: 'none',
              border: 'none',
              letterSpacing: 0.01,
              whiteSpace: 'pre-wrap',
              overflowWrap: 'anywhere',
            }}
          >
            {renderNumberedLines()}
          </pre>
        </div>
      )}
    </div>
  );
}
