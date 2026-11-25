import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiFilePlus } from 'react-icons/fi';
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css';
import javascript from 'highlight.js/lib/languages/javascript';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import java from 'highlight.js/lib/languages/java';
import kotlin from 'highlight.js/lib/languages/kotlin';
import { listenBroadcast, postBroadcast } from '../utils/broadcast';

hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('python', python);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('bash', bash);
hljs.registerLanguage('json', json);
hljs.registerLanguage('java', java);
hljs.registerLanguage('kotlin', kotlin);

// Exact UI/UX of original pages/[id].tsx, with memoized hljs highlighting.
export default function PasteViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [permanent, setPermanent] = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [timeLeftLabel, setTimeLeftLabel] = useState<string | null>(null);
  const [showImports, setShowImports] = useState(false);

  useEffect(() => {
    if (!id) return;
    let active = true;
    fetch(`/api/paste/${encodeURIComponent(id)}?touch=1`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        return response.json();
      })
      .then((data) => {
        if (!active) return;
        setContent(typeof data.content === 'string' ? data.content : 'Failed to load paste.');
        setName(typeof data.name === 'string' ? data.name : '');
        setPermanent(data.permanent === true || data.permanent === 'true');
        if (data && typeof data.expiresAt === 'string') {
          setExpiresAt(data.expiresAt);
          postBroadcast({ type: 'paste_touched', id, expiresAt: data.expiresAt });
        } else {
          setExpiresAt(null);
        }
      })
      .catch(() => {
        if (active) setContent('Failed to load paste.');
      });
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => {
    if (!id) return;
    return listenBroadcast((msg) => {
      if (msg?.type === 'paste_touched' && msg.id === id && msg.expiresAt) {
        setExpiresAt(msg.expiresAt);
      }
    });
  }, [id]);

  useEffect(() => {
    if (!expiresAt || permanent) {
      setTimeLeftLabel(null);
      return;
    }

    const updateLabel = () => {
      const target = new Date(expiresAt).getTime();
      if (!target || Number.isNaN(target)) {
        setTimeLeftLabel(null);
        return;
      }
      const diff = target - Date.now();
      if (diff <= 0) {
        setTimeLeftLabel('Deleting soon');
        return;
      }
      const totalSeconds = Math.floor(diff / 1000);
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
  }, [expiresAt, permanent]);

  const parsedHighlight = useMemo(() => {
    if (!content) {
      return {
        detectedLang: 'plaintext',
        highlighted: '',
        importBlock: '',
        beforeImports: '',
        afterImports: '',
        beforeHtml: '',
        afterHtml: '',
        importLinesHtml: [] as string[],
      };
    }

    const result = hljs.highlightAuto(content);
    const detectedLang = result.language || 'plaintext';
    const lines = content.split(/\r?\n/);

    let start = -1;
    let end = -1;
    const isImportLine = (line: string) => /^(\s*)import(\s+type|\s+static|\s+)/.test(line);
    const isBlankOrComment = (line: string) => /^(\s*$|\s*\/\/.*$)/.test(line);

    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (start === -1) {
        if (isImportLine(line)) {
          start = i;
          end = i;
        }
      } else if (isImportLine(line) || isBlankOrComment(line)) {
        end = i;
      } else {
        break;
      }
    }

    if (start === -1) {
      return {
        detectedLang,
        highlighted: result.value,
        importBlock: '',
        beforeImports: content,
        afterImports: '',
        beforeHtml: '',
        afterHtml: '',
        importLinesHtml: [] as string[],
      };
    }

    const beforeImports = lines.slice(0, start).join('\n');
    const importBlock = lines.slice(start, end + 1).join('\n');
    const afterImports = lines.slice(end + 1).join('\n');
    const importLines = importBlock.split(/\r?\n/).filter((line) => line.trim().length > 0);

    return {
      detectedLang,
      highlighted: result.value,
      importBlock,
      beforeImports,
      afterImports,
      beforeHtml: hljs.highlightAuto(beforeImports, [detectedLang]).value,
      afterHtml: hljs.highlightAuto(afterImports, [detectedLang]).value,
      importLinesHtml: importLines.map((line) => hljs.highlightAuto(line, [detectedLang]).value),
    };
  }, [content]);

  const nameHtml = useMemo(() => {
    if (!name) return '';
    const HR_PLACEHOLDER = '\u0001HR\u0001';
    const hrHtml =
      '<hr style="margin:6px 0;border:none;border-top:1px solid rgba(255,255,255,0.25);" />';
    return name
      .replace(/<br\s*\/?/gi, '\n')
      .replace(/<hr\s*\/?/gi, HR_PLACEHOLDER)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\n/g, '<br />')
      .split(HR_PLACEHOLDER)
      .join(hrHtml);
  }, [name]);

  const renderImports = () => {
    const { importLinesHtml } = parsedHighlight;
    if (!importLinesHtml.length) return null;

    if (!showImports) {
      return (
        <span
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer' }}
          onClick={() => setShowImports(true)}
        >
          <span
            style={{
              fontSize: 16,
              transition: 'transform 0.2s',
              transform: 'rotate(0deg)',
              display: 'inline-block',
              marginRight: 6,
              color: '#90caf9',
              userSelect: 'none',
            }}
          >
            ▶
          </span>
          <span
            dangerouslySetInnerHTML={{ __html: importLinesHtml[0] }}
            style={{ display: 'inline-block' }}
          />
        </span>
      );
    }

    return (
      <span style={{ display: 'block' }}>
        {importLinesHtml.map((html, idx) => (
          <span
            key={idx}
            style={{
              display: 'flex',
              alignItems: 'center',
              cursor: idx === 0 ? 'pointer' : 'default',
            }}
            onClick={idx === 0 ? () => setShowImports(false) : undefined}
          >
            {idx === 0 && (
              <span
                style={{
                  fontSize: 16,
                  transition: 'transform 0.2s',
                  transform: 'rotate(90deg)',
                  display: 'inline-block',
                  marginRight: 6,
                  color: '#90caf9',
                  userSelect: 'none',
                }}
              >
                ▶
              </span>
            )}
            <span dangerouslySetInnerHTML={{ __html: html }} style={{ display: 'inline-block' }} />
          </span>
        ))}
      </span>
    );
  };

  const renderCode = () => {
    if (!parsedHighlight.importBlock) {
      return (
        <code
          className={`hljs ${parsedHighlight.detectedLang}`}
          dangerouslySetInnerHTML={{ __html: parsedHighlight.highlighted }}
          style={{
            background: 'none',
            color: 'inherit',
            fontFamily: 'inherit',
            fontSize: 'inherit',
            lineHeight: 'inherit',
            display: 'block',
            whiteSpace: 'pre',
            minWidth: '100%',
            minHeight: '100%',
          }}
        />
      );
    }

    return (
      <>
        {parsedHighlight.beforeImports && (
          <div
            dangerouslySetInnerHTML={{ __html: parsedHighlight.beforeHtml }}
            style={{ display: 'block', whiteSpace: 'pre' }}
          />
        )}
        {renderImports()}
        {parsedHighlight.afterImports && (
          <div
            dangerouslySetInnerHTML={{ __html: parsedHighlight.afterHtml }}
            style={{ display: 'block', whiteSpace: 'pre' }}
          />
        )}
      </>
    );
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
          maxWidth: 240,
          padding: 8,
          background: 'rgba(40, 40, 40, 0.92)',
          border: '1px solid rgba(255,255,255,0.12)',
          borderRadius: 8,
          boxShadow: '0 2px 8px rgba(0,0,0,0.2)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-end',
          gap: 6,
          flexShrink: 0,
        }}
      >
        {!permanent && timeLeftLabel && (
          <div
            style={{
              fontSize: 11,
              color: '#ffb74d',
              whiteSpace: 'nowrap',
            }}
          >
            {timeLeftLabel}
          </div>
        )}
        {name && (
          <div
            title={name || 'Untitled'}
            style={{
              maxWidth: 220,
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
        <button
          onClick={() => navigate('/')}
          title="New"
          aria-label="New paste"
          style={{
            backgroundColor: '#1e1e1e',
            color: '#b0b0b0',
            border: '1px solid #333',
            borderRadius: '4px',
            padding: '10px',
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'background-color 0.3s ease',
          }}
        >
          <FiFilePlus size={20} />
        </button>
      </div>
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
          style={{
            width: '100vw',
            height: '100%',
            margin: 0,
            padding: '10px 8vw 18px 8vw',
            fontSize: 'clamp(11px, 2vw, 15px)',
            lineHeight: 1.8,
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
          {renderCode()}
        </pre>
      </div>
    </div>
  );
}
