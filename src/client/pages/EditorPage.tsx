import React, { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { FiFilePlus, FiLogIn, FiSave, FiSliders } from 'react-icons/fi';
import { useNotification } from '../components/NotificationProvider';
import { useSession } from '../hooks/useSession';
import { postBroadcast } from '../utils/broadcast';

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
  transition: 'background-color 0.3s ease',
};

export default function EditorPage({ cloneMode = false }: { cloneMode?: boolean }) {
  const navigate = useNavigate();
  const { id: cloneId } = useParams<{ id: string }>();
  const { authenticated: isLoggedIn } = useSession();
  const { addNotification } = useNotification();

  const [content, setContent] = useState('');
  const [name, setName] = useState('');
  const [isPermanent, setIsPermanent] = useState(false);

  useEffect(() => {
    if (!cloneMode || !cloneId) return;
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
        if (active) addNotification('Failed to load paste.');
      });
    return () => {
      active = false;
    };
  }, [cloneMode, cloneId, addNotification]);

  const handleSave = async () => {
    if (isLoggedIn && isPermanent && !name.trim()) {
      addNotification('Please provide a name for the paste.');
      return;
    }

    if (!content) {
      addNotification('Content is empty!');
      return;
    }

    const response = await fetch('/api/paste', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ content, name, permanent: isPermanent }),
    });

    if (response.ok) {
      const data = await response.json();
      postBroadcast({
        type: 'paste_created',
        paste: { id: data.id, name, permanent: isPermanent, createdAt: new Date().toISOString() },
      });
      navigate(`/${data.id}`);
    } else {
      const data = await response.json().catch(() => ({}));
      addNotification(data.message || 'Failed to save paste.');
    }
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
              placeholder={
                isLoggedIn && isPermanent
                  ? 'Enter name (required for permanent)'
                  : 'Enter name (optional)'
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
              value={content}
              onChange={(e) => setContent(e.target.value)}
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
                gap: '10px',
                backgroundColor: '#1e1e1e',
                padding: '5px',
                borderRadius: '8px',
              }}
            >
              {isLoggedIn && (
                <button
                  onClick={() => navigate('/dashboard')}
                  style={iconButtonStyle}
                  title="Dashboard"
                  aria-label="Dashboard"
                >
                  <FiSliders size={20} />
                </button>
              )}
              {!isLoggedIn && (
                <button
                  onClick={() => navigate('/login')}
                  style={{ ...iconButtonStyle, color: '#888' }}
                  title="Log in"
                  aria-label="Log in"
                >
                  <FiLogIn size={20} />
                </button>
              )}
              {isLoggedIn && (
                <button
                  onClick={() => setIsPermanent((p) => !p)}
                  style={{
                    backgroundColor: isPermanent ? '#2d5016' : '#1e1e1e',
                    color: isPermanent ? '#90ee90' : '#888',
                    border: '1px solid #333',
                    borderRadius: '4px',
                    padding: '10px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 11,
                    fontWeight: 600,
                    transition: 'background-color 0.2s ease, color 0.2s ease',
                  }}
                  title={
                    isPermanent
                      ? 'Permanent (click to make temporary)'
                      : 'Temporary (click to make permanent)'
                  }
                >
                  {isPermanent ? 'Permanent' : 'Temp'}
                </button>
              )}
              <button
                onClick={() => setContent('')}
                disabled={!content}
                style={{
                  backgroundColor: !content ? '#555' : '#1e1e1e',
                  color: !content ? '#888' : '#e0e0e0',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '10px',
                  cursor: !content ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.3s ease',
                }}
                title="New"
              >
                <FiFilePlus size={20} />
              </button>
              <button
                onClick={() => void handleSave()}
                style={{
                  backgroundColor: '#1e1e1e',
                  color: '#e0e0e0',
                  border: '1px solid #333',
                  borderRadius: '4px',
                  padding: '10px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'background-color 0.3s ease',
                }}
                title="Save"
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
