import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { FiKey } from 'react-icons/fi';
import { useNotification } from '../components/NotificationProvider';
import { useSession } from '../hooks/useSession';

// Exact UI/UX of original pages/login.tsx
export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
  const [totpChallenge, setTotpChallenge] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
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
    return () => {
      active = false;
    };
  }, []);

  const handleLogin = async () => {
    if (!/\S+@\S+\.\S+/.test(email)) {
      addNotification('Please enter a valid email.');
      return;
    }

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
  };

  const handleVerifyTotp = async () => {
    if (!totpChallenge) return;
    const code = totpCode.trim();
    if (!/^\d{6}$/.test(code)) {
      addNotification('Enter the 6-digit code from your authenticator app.');
      return;
    }

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
      } else {
        void handleLogin();
      }
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
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
          padding: 24,
          background: '#232323',
          border: '1px solid rgba(255,255,255,0.08)',
          borderRadius: 10,
          boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
        }}
      >
        <h1 style={{ margin: '0 0 4px', fontSize: 20, color: '#e0e0e0' }}>Cleanbin</h1>
        {totpChallenge ? (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#777', lineHeight: 1.5 }}>
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
              style={{ marginBottom: 16, letterSpacing: 4, textAlign: 'center' }}
            />
            <button onClick={() => void handleVerifyTotp()} style={{ width: '100%', fontWeight: 600 }}>
              Verify
            </button>
            <button
              onClick={() => {
                setTotpChallenge(null);
                setTotpCode('');
              }}
              className="login-secondary-button"
              style={{
                width: '100%',
                marginTop: 10,
                background: '#1e1e1e',
                color: '#e0e0e0',
                border: '1px solid #333',
                fontWeight: 600,
              }}
            >
              Back
            </button>
          </>
        ) : (
          <>
            <p style={{ margin: '0 0 18px', fontSize: 12, color: '#777', lineHeight: 1.5 }}>
              Sign in to create permanent pastes.
            </p>
            <input
              type="email"
              placeholder="Enter email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={{ marginBottom: 10 }}
            />
            <input
              type="password"
              placeholder="Enter password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{ marginBottom: 16 }}
            />
            <button onClick={() => void handleLogin()} style={{ width: '100%', fontWeight: 600 }}>
              Login
            </button>
            {passkeyRegistered && (
              <>
                <p style={{ margin: '18px 0 10px', fontSize: 11, color: '#666', textAlign: 'center' }}>
                  or
                </p>
                <button
                  onClick={() => void handlePasskeyLogin()}
                  className="login-secondary-button"
                  style={{
                    width: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    background: '#1e1e1e',
                    color: '#e0e0e0',
                    border: '1px solid #333',
                    fontWeight: 600,
                  }}
                >
                  <FiKey size={16} />
                  Sign in with passkey
                </button>
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
