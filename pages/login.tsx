import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { startAuthentication } from '@simplewebauthn/browser';
import { FiKey } from 'react-icons/fi';
import { useNotification } from '../components/NotificationProvider';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
  const router = useRouter();
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
      router.push('/dashboard');
    } else {
      const data = await response.json();
      addNotification(data.message || 'Invalid credentials');
    }
  };

  const handlePasskeyLogin = async () => {
    try {
      const optionsResponse = await fetch('/api/auth/passkey/login-options', { method: 'POST' });
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
        router.push('/dashboard');
      } else {
        const data = await verifyResponse.json();
        addNotification(data.message || 'Passkey sign in failed');
      }
    } catch {
      addNotification('Passkey sign in was cancelled.');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Enter') {
      handleLogin();
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
        <button onClick={handleLogin} style={{ width: '100%', fontWeight: 600 }}>
          Login
        </button>
        {passkeyRegistered && (
          <>
            <p style={{ margin: '18px 0 10px', fontSize: 11, color: '#666', textAlign: 'center' }}>
              or
            </p>
            <button
              onClick={handlePasskeyLogin}
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
      </div>
    </div>
  );
};

export default Login;
