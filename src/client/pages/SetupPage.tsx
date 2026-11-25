import React, { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useNotification } from '../components/NotificationProvider';
import { useSession } from '../hooks/useSession';

interface SetupSecret {
  groupedSecret: string;
  otpauthUrl: string;
}

const cleanBtnPrimary: React.CSSProperties = {
  width: '100%',
  background: '#282828',
  color: '#e0e0e0',
  border: '1px solid #444',
  borderRadius: 4,
  padding: '9px 14px',
  fontFamily: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
};

const cleanBtnSecondary: React.CSSProperties = {
  width: '100%',
  marginTop: 8,
  background: '#1e1e1e',
  color: '#b0b0b0',
  border: '1px solid #333',
  borderRadius: 4,
  padding: '9px 14px',
  fontFamily: 'inherit',
  fontSize: 12,
  cursor: 'pointer',
};

export default function SetupPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refreshSession } = useSession();
  const { addNotification } = useNotification();

  const token = searchParams.get('token');
  const challenge = searchParams.get('challenge');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [secret, setSecret] = useState<SetupSecret | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [fatal, setFatal] = useState<string | null>(null);

  const requestSecret = async (payload: Record<string, string>) => {
    setBusy(true);
    try {
      const response = await fetch('/api/setup/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        addNotification(data.message || 'Could not start the setup.');
        return;
      }
      setSecret({ groupedSecret: data.groupedSecret, otpauthUrl: data.otpauthUrl });
    } catch {
      addNotification('Could not start the setup.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!token && !challenge) {
      setFatal('This setup link is incomplete. Ask an administrator for a new one.');
      return;
    }
    if (challenge) {
      void requestSecret({ challenge });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, challenge]);

  const handlePasswordSubmit = async () => {
    if (busy || !token) return;
    if (password.length < 10) {
      addNotification('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      addNotification('Passwords do not match.');
      return;
    }
    await requestSecret({ token, password });
  };

  const handleActivate = async () => {
    if (busy || !secret) return;
    const normalizedCode = code.trim();
    if (!/^\d{6}$/.test(normalizedCode)) {
      addNotification('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setBusy(true);
    try {
      const payload = token ? { token } : { challenge: challenge || '' };
      const response = await fetch('/api/setup/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, code: normalizedCode }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok) {
        await refreshSession();
        navigate('/dashboard');
        return;
      }
      addNotification(data.message || 'Invalid verification code.');
    } catch {
      addNotification('Could not complete the setup.');
    } finally {
      setBusy(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'Enter') return;
    if (secret) {
      void handleActivate();
    } else if (token) {
      void handlePasswordSubmit();
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#1e1e1e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
      }}
    >
      <div
        onKeyDown={handleKeyDown}
        style={{
          width: '100%',
          maxWidth: 420,
          padding: 22,
          background: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>cleanbin · setup</h1>
          <Link to="/" style={{ fontSize: 11, color: '#666', textDecoration: 'none' }}>
            ← editor
          </Link>
        </div>

        {fatal && (
          <p style={{ margin: '8px 0 0', fontSize: 12, color: '#e07a7a', lineHeight: 1.5 }}>{fatal}</p>
        )}

        {!fatal && !secret && token && (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              Step 1 of 2 · Choose a password (10+ characters) to activate your account.
            </p>
            <input
              type="password"
              placeholder="new password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ marginBottom: 8, fontFamily: 'inherit', fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              style={{ marginBottom: 14, fontFamily: 'inherit', fontSize: 13 }}
            />
            <button
              onClick={() => void handlePasswordSubmit()}
              disabled={busy}
              className="login-secondary-button"
              style={cleanBtnPrimary}
            >
              continue
            </button>
          </>
        )}

        {!fatal && secret && (
          <>
            <p style={{ margin: '0 0 12px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              Step 2 of 2 · Add this secret key to your authenticator app, then enter the 6-digit code.
            </p>
            <div
              style={{
                margin: '0 0 12px',
                padding: 12,
                background: '#181818',
                border: '1px solid #333',
                borderRadius: 4,
              }}
            >
              <div style={{ fontSize: 11, color: '#777', marginBottom: 4 }}>secret key</div>
              <code style={{ fontSize: 13, letterSpacing: 1, color: '#e0e0e0', wordBreak: 'break-all' }}>
                {secret.groupedSecret}
              </code>
            </div>
            <p style={{ margin: '0 0 14px', fontSize: 11, color: '#666', lineHeight: 1.5, wordBreak: 'break-all' }}>
              {secret.otpauthUrl}
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              style={{ marginBottom: 12, letterSpacing: 4, textAlign: 'center', fontFamily: 'inherit', fontSize: 13 }}
            />
            <button
              onClick={() => void handleActivate()}
              disabled={busy}
              className="login-secondary-button"
              style={cleanBtnPrimary}
            >
              activate 2fa
            </button>
            <button
              onClick={() => navigate('/login')}
              className="login-secondary-button"
              style={cleanBtnSecondary}
            >
              back to sign in
            </button>
          </>
        )}

        {!fatal && !token && !secret && (
          <p style={{ margin: '12px 0 0', fontSize: 12, color: '#888' }}>Preparing setup…</p>
        )}
      </div>
    </div>
  );
}
