import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { FiFilePlus, FiLock, FiLogIn, FiSave, FiSliders, FiUnlock } from 'react-icons/fi';
import { useNotification } from '../components/NotificationProvider';
import { useSession } from '../hooks/useSession';
import { postBroadcast } from '../utils/broadcast';
import { encryptPastePayload } from '../utils/e2ee';
import { buildPasteTarget } from '../utils/urlHash';
import type { PasteTtlOption } from '../../shared/types';

// Exact square icon button geometry & colors from the original Next.js Editor.tsx
const iconButtonStyle: React.CSSProperties = {
  backgroundColor: '#1e1e1e',
  color: '#e0e0e0',
  border: '1px solid #333',
  borderRadius: '4px',
  padding: '10px',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  transition: 'background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease',
};

interface CloneRouterState {
  clonedContent?: string;
  clonedName?: string;
}

export default function EditorPage({ cloneMode = false }: { cloneMode?: boolean }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { id: cloneId } = useParams<{ id: string }>();
  const { authenticated: isLoggedIn } = useSession();
  const { addNotification } = useNotification();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [ttl, setTtl] = useState<PasteTtlOption>('30d');
  const [isEncrypted, setIsEncrypted] = useState(false);
  const [saving, setSaving] = useState(false);

  const isPermanent = isLoggedIn && ttl === 'permanent';
  const isBurn = ttl === 'burn';

  // Reset `permanent` back to `30d` if the user signs out
  useEffect(() => {
    if (!isLoggedIn && ttl === 'permanent') {
      setTtl('30d');
    }
  }, [isLoggedIn, ttl]);

  useEffect(() => {
    if (!cloneMode) return;
    const state = (location.state ?? null) as CloneRouterState | null;
    if (state && typeof state.clonedContent === 'string') {
      setContent(state.clonedContent);
      if (typeof state.clonedName === 'string' && state.clonedName.trim()) {
        setName(`${state.clonedName.trim()} (copy)`);
      }
      return;
    }

    if (!cloneId) return;
    let active = true;
    fetch(`/api/paste?id=${encodeURIComponent(cloneId)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (!active) return;
        setContent(typeof data.content === 'string' ? data.content : '');
        if (typeof data.name === 'string' && data.name.trim()) {
          setName(`${data.name.trim()} (copy)`);
        }
      })
      .catch(() => {
        if (active) addNotification('Failed to load paste for cloning.');
      });
    return () => {
      active = false;
    };
  }, [cloneMode, cloneId, location.state, addNotification]);

  const handleSave = useCallback(async () => {
    if (saving) return;
    if (isPermanent && !name.trim()) {
      addNotification('Please provide a name for the paste.');
      return;
    }

    if (!content) {
      addNotification('Content is empty!');
      return;
    }

    setSaving(true);
    try {
      let payloadContent = content;
      let payloadName = name;
      let keyB64Url: string | null = null;

      if (isEncrypted) {
        const encrypted = await encryptPastePayload({ name: name.trim(), content });
        payloadContent = encrypted.payload;
        // Keep real name inside the encrypted envelope; store a generic label only if permanent requires non-empty name
        payloadName = isPermanent ? 'Encrypted paste' : '';
        keyB64Url = encrypted.keyB64Url;
      }

      const response = await fetch('/api/paste', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          content: payloadContent,
          name: payloadName,
          permanent: isPermanent,
          ttl,
          burnAfterRead: isBurn,
        }),
      });

      if (response.ok) {
        const data = await response.json();
        const target = buildPasteTarget(data.id, { key: keyB64Url });

        postBroadcast({
          type: 'paste_created',
          paste: { id: data.id, name: payloadName, permanent: isPermanent, createdAt: new Date().toISOString() },
        });

        if (isBurn) {
          navigator.clipboard?.writeText(target.fullShareUrl).then(
            () => addNotification('One-time link copied! Self-destructs on first open.'),
            () => addNotification('One-time paste ready. Copy the URL from the address bar.')
          );
          navigate(target.routePath, {
            state: {
              unburnedPreview: {
                content,
                name: name.trim(),
                encrypted: isEncrypted,
              },
            },
          });
          return;
        }

        if (isEncrypted) {
          navigator.clipboard?.writeText(target.fullShareUrl).then(
            () => addNotification('Encrypted URL copied (key stays in # fragment).'),
            () => {}
          );
        }

        navigate(target.routePath);
      } else {
        const data = await response.json().catch(() => ({}));
        addNotification(data.message || 'Failed to save paste.');
      }
    } catch {
      addNotification('Failed to encrypt or save paste.');
    } finally {
      setSaving(false);
    }
  }, [saving, isPermanent, isBurn, isEncrypted, name, content, ttl, addNotification, navigate]);

  // Global Ctrl+S / Cmd+S shortcut
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void handleSave();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleSave]);

  // 2-space Tab / Shift+Tab indentation inside textarea
  const handleTextareaKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key !== 'Tab') return;
    e.preventDefault();
    const el = e.currentTarget;
    const start = el.selectionStart;
    const end = el.selectionEnd;

    if (start === end && !e.shiftKey) {
      const next = content.slice(0, start) + '  ' + content.slice(end);
      setContent(next);
      requestAnimationFrame(() => {
        if (textareaRef.current) {
          textareaRef.current.selectionStart = start + 2;
          textareaRef.current.selectionEnd = start + 2;
        }
      });
      return;
    }

    const lineStart = content.lastIndexOf('\n', start - 1) + 1;
    const selectedBlock = content.slice(lineStart, end);
    const lines = selectedBlock.split('\n');

    let deltaFirst = 0;
    let deltaTotal = 0;
    const transformed = lines.map((line, idx) => {
      if (e.shiftKey) {
        if (line.startsWith('  ')) {
          if (idx === 0) deltaFirst = -2;
          deltaTotal -= 2;
          return line.slice(2);
        }
        if (line.startsWith('\t') || line.startsWith(' ')) {
          if (idx === 0) deltaFirst = -1;
          deltaTotal -= 1;
          return line.slice(1);
        }
        return line;
      }
      if (idx === 0) deltaFirst = 2;
      deltaTotal += 2;
      return `  ${line}`;
    });

    const next = content.slice(0, lineStart) + transformed.join('\n') + content.slice(end);
    const newStart = Math.max(lineStart, start + deltaFirst);
    const newEnd = Math.max(newStart, end + deltaTotal);
    setContent(next);
    requestAnimationFrame(() => {
      if (textareaRef.current) {
        textareaRef.current.selectionStart = newStart;
        textareaRef.current.selectionEnd = newEnd;
      }
    });
  };

  return (
    <div
      className="main-container"
      style={{
        height: '100vh',
        margin: 0,
        padding: 0,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          margin: 0,
          padding: 0,
          overflow: 'hidden',
          height: '100vh',
        }}
      >
        <div
          style={{
            flex: 1,
            display: 'flex',
            flexDirection: 'column',
            height: '100%',
          }}
        >
          <div
            className="editor-container"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              position: 'relative',
            }}
          >
            <input
              type="text"
              className="editor-name-input"
              placeholder={
                isPermanent ? 'Enter name (required for permanent)' : 'Enter name (optional)'
              }
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={{
                marginBottom: '4px',
                padding: '10px',
                borderRadius: '4px',
                border: '1px solid #333',
                backgroundColor: '#1e1e1e',
                color: '#e0e0e0',
                fontFamily: 'monospace',
              }}
            />
            <p className="editor-name-hint">
              In name: use <code>&lt;br&gt;</code> for line breaks and <code>&lt;hr&gt;</code> for a horizontal line.
            </p>
            <textarea
              ref={textareaRef}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={handleTextareaKeyDown}
              placeholder="Write your paste here..."
              className="editor-textarea"
              style={{
                flex: 1,
                width: '100%',
                backgroundColor: '#1e1e1e',
                color: '#e0e0e0',
                border: 'none',
                padding: '10px',
                fontFamily: 'monospace',
                resize: 'none',
                overflowY: 'auto',
              }}
            />
            <div
              className="editor-buttons"
              style={{
                display: 'flex',
                gap: '8px',
                backgroundColor: '#1e1e1e',
                padding: '5px',
                borderRadius: '8px',
              }}
            >
              {isLoggedIn ? (
                <button
                  onClick={() => navigate('/dashboard')}
                  style={iconButtonStyle}
                  title="Dashboard"
                  aria-label="Dashboard"
                >
                  <FiSliders size={20} />
                </button>
              ) : (
                <button
                  onClick={() => navigate('/login')}
                  style={{ ...iconButtonStyle, color: '#888' }}
                  title="Log in"
                  aria-label="Log in"
                >
                  <FiLogIn size={20} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsEncrypted((v) => !v)}
                style={{
                  ...iconButtonStyle,
                  backgroundColor: isEncrypted ? '#1e3320' : '#1e1e1e',
                  color: isEncrypted ? '#90ee90' : '#888',
                  borderColor: isEncrypted ? '#355e38' : '#333',
                }}
                title={
                  isEncrypted
                    ? 'E2EE active: encrypted in browser with AES-256-GCM (click to disable)'
                    : 'Encrypt in browser (zero-knowledge E2EE)'
                }
                aria-label="Toggle end-to-end encryption"
                aria-pressed={isEncrypted}
              >
                {isEncrypted ? <FiLock size={18} /> : <FiUnlock size={18} />}
              </button>

              <select
                aria-label="Paste expiration"
                title="Expiration / mode"
                value={ttl}
                onChange={(e) => setTtl(e.target.value as PasteTtlOption)}
                style={{
                  width: 'auto',
                  height: 42,
                  marginBottom: 0,
                  padding: '0 10px',
                  borderRadius: '4px',
                  border: `1px solid ${isPermanent ? '#3d6b1f' : isBurn ? '#5c3c1e' : '#333'}`,
                  backgroundColor: isPermanent ? '#2d5016' : isBurn ? '#2b1f14' : '#1e1e1e',
                  color: isPermanent ? '#90ee90' : isBurn ? '#ffb74d' : '#b0b0b0',
                  fontFamily: 'monospace',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                <option value="30d">30d</option>
                <option value="7d">7d</option>
                <option value="24h">24h</option>
                <option value="1h">1h</option>
                <option value="burn">1 read</option>
                {isLoggedIn && <option value="permanent">Perm</option>}
              </select>

              <button
                onClick={() => setContent('')}
                disabled={!content}
                style={{
                  ...iconButtonStyle,
                  backgroundColor: !content ? '#555' : '#1e1e1e',
                  color: !content ? '#888' : '#e0e0e0',
                  cursor: !content ? 'not-allowed' : 'pointer',
                }}
                title="New"
              >
                <FiFilePlus size={20} />
              </button>

              <button
                onClick={() => void handleSave()}
                disabled={saving}
                style={iconButtonStyle}
                title="Save (Ctrl+S)"
              >
                <FiSave size={20} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
