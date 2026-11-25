import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { resetDemoState } from './demoBackend';
import { useSession } from '../hooks/useSession';
import { useNotification } from '../components/NotificationProvider';

export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { refreshSession } = useSession();
  const { addNotification } = useNotification();

  if (dismissed) return null;

  const pillBtn: React.CSSProperties = {
    background: 'transparent',
    color: '#cfcfcf',
    border: '1px solid #333',
    borderRadius: 4,
    padding: '2px 7px',
    fontSize: 11,
    fontFamily: 'inherit',
    cursor: 'pointer',
    lineHeight: 1.4,
  };

  const activeBtn: React.CSSProperties = {
    ...pillBtn,
    background: '#2a2a2a',
    color: '#fff',
    borderColor: '#4a4a4a',
  };

  const handleReset = async () => {
    resetDemoState();
    await refreshSession();
    addNotification('Demo state reset in memory.');
    navigate('/');
  };

  return (
    <div
      role="region"
      aria-label="Live demo notice"
      style={{
        position: 'fixed',
        left: 12,
        bottom: 12,
        zIndex: 9999,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
        padding: '6px 10px',
        background: '#181818',
        border: '1px solid #333',
        borderRadius: 4,
        color: '#8c8c8c',
        fontSize: 11,
        fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
      }}
    >
      <span style={{ color: '#e0e0e0', fontWeight: 600 }}>LIVE DEMO</span>
      <span>· in-memory only (nothing saved)</span>
      <button
        type="button"
        style={location.pathname === '/' ? activeBtn : pillBtn}
        onClick={() => navigate('/')}
      >
        Editor
      </button>
      <button
        type="button"
        style={location.pathname === '/hono-rate-limiter' ? activeBtn : pillBtn}
        onClick={() => navigate('/hono-rate-limiter')}
      >
        Sample Paste
      </button>
      <button
        type="button"
        style={location.pathname.startsWith('/dashboard') ? activeBtn : pillBtn}
        onClick={() => navigate('/dashboard')}
      >
        Dashboard
      </button>
      <button type="button" style={pillBtn} onClick={() => void handleReset()}>
        Reset
      </button>
      <button
        type="button"
        title="Hide demo bar"
        style={{ ...pillBtn, border: 'none', padding: '2px 4px', color: '#777' }}
        onClick={() => setDismissed(true)}
      >
        ×
      </button>
    </div>
  );
}
