import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { FiKey } from 'react-icons/fi';
import { useNotification } from '../components/NotificationProvider';
import { useSession } from '../hooks/useSession';
import type { RegistrationMode } from '../../shared/types';

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

export default function LoginPage() {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [registrationMode, setRegistrationMode] = useState<RegistrationMode>('invite');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const { refreshSession } = useSession();
  const { addNotification } = useNotification();

  useEffect(() => {
    let active = true;
    fetch('/api/auth/passkey/status')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data) setPasskeyRegistered(!!data.registered);
      })
      .catch(() => {});

    fetch('/api/settings')
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (active && data && data.registrationMode === 'open') {
          setRegistrationMode('open');
        }
      })
      .catch(() => {});

    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    if (busy) return;
    if (!/\S+@\S+\.\S+/.test(email)) {
      addNotification('Please enter a valid email.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        if (data.totpRequired && typeof data.challenge === 'string') {
          setTotpChallenge(data.challenge);
          return;
        }
        if (data.setupRequired && typeof data.challenge === 'string') {
          navigate(`/setup?challenge=${encodeURIComponent(data.challenge)}`);
          return;
        }
        await refreshSession();
        navigate('/dashboard');
      } else {
        const data = await response.json().catch(() => ({}));
        addNotification(data.message || 'Invalid credentials');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleRegister = async () => {
    if (busy) return;
    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      addNotification('Please enter a valid email.');
      return;
    }
    if (password.length < 10) {
      addNotification('Password must be at least 10 characters.');
      return;
    }
    if (password !== confirmPassword) {
      addNotification('Passwords do not match.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password }),
      });
      const data = await response.json().catch(() => ({}));
      if (response.ok && data.verificationEmailSent) {
        addNotification('Verification link sent. Check your email to finish 2FA setup.');
        setPassword('');
        setConfirmPassword('');
        setMode('login');
        return;
      }
      if (response.ok && data.setupRequired && typeof data.challenge === 'string') {
        addNotification('Account created. Configure mandatory 2FA to finish.');
        navigate(`/setup?challenge=${encodeURIComponent(data.challenge)}`);
        return;
      }
      addNotification(data.message || 'Registration failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyTotp = async () => {
    if (!totpChallenge || busy) return;
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      addNotification('Enter the 6-digit code from your authenticator app.');
      return;
    }

    setBusy(true);
    try {
      const response = await fetch('/api/auth/2fa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ challenge: totpChallenge, code }),
      });

      if (response.ok) {
        await refreshSession();
        navigate('/dashboard');
      } else {
        const data = await response.json().catch(() => ({}));
        addNotification(data.message || 'Invalid verification code');
      }
    } finally {
      setBusy(false);
    }
  };

  const handlePasskeyLogin = async () => {
    try {
      const optionsResponse = await fetch('/api/auth/passkey/login-options', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() || undefined }),
      });
      if (!optionsResponse.ok) {
        addNotification('Could not start passkey sign in.');
        return;
      }
      const optionsJSON = await optionsResponse.json();
      const authResponse = await startAuthentication({ optionsJSON });

      const verifyResponse = await fetch('/api/auth/passkey/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: authResponse }),
      });

      if (verifyResponse.ok) {
        await refreshSession();
        navigate('/dashboard');
      } else {
        const data = await verifyResponse.json().catch(() => ({}));
        addNotification(data.message || 'Passkey sign in failed');
      }
    } catch {
      addNotification('Passkey sign in was cancelled.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      if (totpChallenge) {
        void handleVerifyTotp();
      } else if (mode === 'register' && registrationMode === 'open') {
        void handleRegister();
      } else {
        void handleLogin();
      }
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
          maxWidth: 360,
          padding: 22,
          background: '#1e1e1e',
          border: '1px solid #333',
          borderRadius: 4,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 10 }}>
          <h1 style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#e0e0e0' }}>cleanbin</h1>
          <Link to="/" style={{ fontSize: 11, color: '#666', textDecoration: 'none' }}>
            ← editor
          </Link>
        </div>

        {!totpChallenge && registrationMode === 'open' && (
          <div
            style={{
              display: 'flex',
              gap: 6,
              marginBottom: 14,
              borderBottom: '1px solid #2b2b2b',
              paddingBottom: 10,
            }}
          >
            <button
              type="button"
              onClick={() => setMode('login')}
              className="login-secondary-button"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 11,
                fontFamily: 'inherit',
                borderRadius: 4,
                background: mode === 'login' ? '#282828' : '#1e1e1e',
                color: mode === 'login' ? '#e0e0e0' : '#777',
                border: `1px solid ${mode === 'login' ? '#444' : '#333'}`,
              }}
            >
              sign in
            </button>
            <button
              type="button"
              onClick={() => setMode('register')}
              className="login-secondary-button"
              style={{
                flex: 1,
                padding: '6px 10px',
                fontSize: 11,
                fontFamily: 'inherit',
                borderRadius: 4,
                background: mode === 'register' ? '#282828' : '#1e1e1e',
                color: mode === 'register' ? '#e0e0e0' : '#777',
                border: `1px solid ${mode === 'register' ? '#444' : '#333'}`,
              }}
            >
              create account
            </button>
          </div>
        )}

        {totpChallenge ? (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              Enter the 6-digit code from your authenticator app.
            </p>
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={totpCode}
              onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
              style={{ marginBottom: 12, letterSpacing: 4, textAlign: 'center', fontFamily: 'inherit', fontSize: 13 }}
            />
            <button
              onClick={() => void handleVerifyTotp()}
              disabled={busy}
              className="login-secondary-button"
              style={cleanBtnPrimary}
            >
              verify
            </button>
            <button
              onClick={() => {
                setTotpChallenge(null);
                setTotpCode('');
              }}
              className="login-secondary-button"
              style={cleanBtnSecondary}
            >
              back
            </button>
          </>
        ) : mode === 'register' && registrationMode === 'open' ? (
          <>
            <p style={{ margin: '0 0 14px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              Create an account (mandatory 2FA setup on next step).
            </p>
            <input
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginBottom: 8, fontFamily: 'inherit', fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="password (10+ chars)"
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
              onClick={() => void handleRegister()}
              disabled={busy}
              className="login-secondary-button"
              style={cleanBtnPrimary}
            >
              create account
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 16px', fontSize: 12, color: '#888', lineHeight: 1.5 }}>
              Sign in to manage permanent pastes.
            </p>
            <input
              type="email"
              placeholder="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginBottom: 8, fontFamily: 'inherit', fontSize: 13 }}
            />
            <input
              type="password"
              placeholder="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ marginBottom: 14, fontFamily: 'inherit', fontSize: 13 }}
            />
            <button
              onClick={() => void handleLogin()}
              disabled={busy}
              className="login-secondary-button"
              style={cleanBtnPrimary}
            >
              sign in
            </button>
            {import.meta.env.VITE_DEMO_MODE === '1' && (
              <button
                type="button"
                className="login-secondary-button"
                onClick={() => {
                  setEmail('demo@example.com');
                  setPassword('demo');
                  void fetch('/api/auth', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email: 'demo@example.com', password: 'demo' }),
                  }).then(async () => {
                    await refreshSession();
                    navigate('/dashboard');
                  });
                }}
                style={cleanBtnSecondary}
              >
                enter demo dashboard (demo@example.com)
              </button>
            )}
            {passkeyRegistered && (
              <>
                <p style={{ margin: '14px 0 8px', fontSize: 11, color: '#666', textAlign: 'center' }}>or</p>
                <button
                  onClick={() => void handlePasskeyLogin()}
                  className="login-secondary-button"
                  style={{
                    ...cleanBtnSecondary,
                    marginTop: 0,
                    color: '#e0e0e0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                  }}
                >
                  <FiKey size={14} />
                  sign in with passkey
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
