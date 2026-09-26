import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { useNotification } from '../components/NotificationProvider';

interface SetupSecret {
    groupedSecret: string;
    otpauthUrl: string;
}

type SetupPayload = Record<string, string>;

const Setup = () => {
    const router = useRouter();
    const { addNotification } = useNotification();
    const [ready, setReady] = useState(false);
    const [token, setToken] = useState<string | null>(null);
    const [challenge, setChallenge] = useState<string | null>(null);
    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [secret, setSecret] = useState<SetupSecret | null>(null);
    const [code, setCode] = useState('');
    const [busy, setBusy] = useState(false);
    const [fatal, setFatal] = useState<string | null>(null);

    const requestSecret = async (payload: SetupPayload) => {
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
        if (!router.isReady) return;
        const tokenParam = typeof router.query.token === 'string' ? router.query.token : null;
        const challengeParam = typeof router.query.challenge === 'string' ? router.query.challenge : null;

        if (!tokenParam && !challengeParam) {
            setFatal('This setup link is incomplete. Ask an administrator for a new one.');
            setReady(true);
            return;
        }

        setToken(tokenParam);
        setChallenge(challengeParam);
        setReady(true);

        if (challengeParam) {
            void requestSecret({ challenge: challengeParam });
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [router.isReady]);

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
            const payload = token ? { token } : { challenge };
            const response = await fetch('/api/setup/complete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ ...payload, code: normalizedCode }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                router.push('/dashboard');
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

    if (!ready) {
        return null;
    }

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
                    maxWidth: 420,
                    padding: 24,
                    background: '#232323',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    boxShadow: '0 2px 12px rgba(0,0,0,0.35)',
                }}
            >
                <h1 style={{ margin: '0 0 4px', fontSize: 20, color: '#e0e0e0' }}>Cleanbin</h1>

                {fatal && (
                    <p style={{ margin: '0 0 18px', fontSize: 12, color: '#e07a7a', lineHeight: 1.5 }}>{fatal}</p>
                )}

                {!fatal && !secret && (
                    <>
                        <p style={{ margin: '0 0 18px', fontSize: 12, color: '#777', lineHeight: 1.5 }}>
                            Step 1 of 2. Choose a password to activate your account.
                        </p>
                        <input
                            type="password"
                            placeholder="New password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{ marginBottom: 10 }}
                        />
                        <input
                            type="password"
                            placeholder="Confirm password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            style={{ marginBottom: 16 }}
                        />
                        <button
                            onClick={handlePasswordSubmit}
                            disabled={busy}
                            style={{ width: '100%', fontWeight: 600 }}
                        >
                            Continue
                        </button>
                    </>
                )}

                {!fatal && secret && (
                    <>
                        <p style={{ margin: '0 0 12px', fontSize: 12, color: '#777', lineHeight: 1.5 }}>
                            Step 2 of 2. Add the secret key to your authenticator app, then enter the 6-digit code.
                        </p>
                        <div
                            style={{
                                margin: '0 0 12px',
                                padding: 12,
                                background: '#1a1a1a',
                                border: '1px solid #333',
                                borderRadius: 6,
                            }}
                        >
                            <div style={{ fontSize: 11, color: '#777', marginBottom: 6 }}>Secret key</div>
                            <code style={{ fontSize: 14, letterSpacing: 1, color: '#e0e0e0', wordBreak: 'break-all' }}>
                                {secret.groupedSecret}
                            </code>
                        </div>
                        <p style={{ margin: '0 0 16px', fontSize: 11, color: '#666', lineHeight: 1.5, wordBreak: 'break-all' }}>
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
                            style={{ marginBottom: 16, letterSpacing: 4, textAlign: 'center' }}
                        />
                        <button
                            onClick={handleActivate}
                            disabled={busy}
                            style={{ width: '100%', fontWeight: 600 }}
                        >
                            Activate 2FA
                        </button>
                        <button
                            onClick={() => router.push('/login')}
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
                            Back to sign in
                        </button>
                    </>
                )}

                {!fatal && !token && !secret && (
                    <p style={{ margin: '12px 0 0', fontSize: 12, color: '#777' }}>Preparing setup...</p>
                )}
            </div>
        </div>
    );
};

export default Setup;
