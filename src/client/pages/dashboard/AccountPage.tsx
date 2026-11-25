import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { FiClipboard } from 'react-icons/fi';
import { renderSVG } from 'uqr';
import { Button, ConfirmModal, IconButton, type ConfirmRequest } from '../../components/CleanUi';
import { useNotification } from '../../components/NotificationProvider';
import { useSession } from '../../hooks/useSession';
import { describeUserAgent, formatBytes, formatDate, formatDateTime } from '../../utils/format';
import type { ApiTokenInfo, DashboardSessionInfo, UserQuotaUsage } from '../../../shared/types';

export default function AccountPage() {
  const navigate = useNavigate();
  const { email, role, totpEnabled, permanentDeleteLimit, refreshSession, signOut } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [totpSetup, setTotpSetup] = useState<{ groupedSecret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpBusy, setTotpBusy] = useState(false);
  const [sessions, setSessions] = useState<DashboardSessionInfo[] | null>(null);
  const [tokens, setTokens] = useState<ApiTokenInfo[] | null>(null);
  const [usage, setUsage] = useState<UserQuotaUsage | null>(null);
  const [tokenLabel, setTokenLabel] = useState('');
  const [tokenBusy, setTokenBusy] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const originUrl =
    typeof window !== 'undefined' ? window.location.origin : 'https://cleanbin.xyz';

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('sessions');
      const data = await res.json();
      setSessions(Array.isArray(data.sessions) ? data.sessions : []);
    } catch {
      setSessions([]);
    }
  }, []);

  const loadTokensAndUsage = useCallback(async () => {
    try {
      const res = await fetch('/api/tokens', { cache: 'no-store' });
      if (!res.ok) throw new Error('tokens');
      const data = await res.json();
      setTokens(Array.isArray(data.tokens) ? data.tokens : []);
      if (data.usage) setUsage(data.usage as UserQuotaUsage);
    } catch {
      setTokens([]);
    }
  }, []);

  useEffect(() => {
    if (!email) return;
    let active = true;
    fetch(`/api/auth/passkey/status?email=${encodeURIComponent(email)}`)
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then((data) => {
        if (active) setPasskeyRegistered(!!data.hasPasskey);
      })
      .catch(() => {
        if (active) setPasskeyRegistered(false);
      });
    return () => {
      active = false;
    };
  }, [email]);

  useEffect(() => {
    void loadSessions();
    void loadTokensAndUsage();
  }, [loadSessions, loadTokensAndUsage]);

  const registerPasskey = async () => {
    setPasskeyBusy(true);
    try {
      if (import.meta.env.VITE_DEMO_MODE === '1') {
        const demoRes = await fetch('/api/auth/passkey/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ demo: true }),
        });
        if (demoRes.ok) {
          setPasskeyRegistered(true);
          addNotification('Simulated passkey active in memory for this demo tab.');
        }
        return;
      }
      const optRes = await fetch('/api/auth/passkey/register-options', { method: 'POST' });
      if (!optRes.ok) {
        addNotification('Could not start passkey registration.');
        return;
      }
      const optionsJSON = await optRes.json();
      const registrationResponse = await startRegistration({ optionsJSON });
      const verifyRes = await fetch('/api/auth/passkey/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ response: registrationResponse }),
      });
      if (verifyRes.ok) {
        setPasskeyRegistered(true);
        addNotification('Passkey registered. Password sign-in disabled.');
      } else {
        const data = await verifyRes.json().catch(() => ({}));
        addNotification(data.message || 'Passkey registration failed.');
      }
    } catch {
      addNotification('Passkey registration cancelled.');
    } finally {
      setPasskeyBusy(false);
    }
  };

  const removePasskey = async () => {
    setPasskeyBusy(true);
    try {
      const res = await fetch('/api/auth/passkey', { method: 'DELETE' });
      if (res.ok) {
        setPasskeyRegistered(false);
        addNotification('Passkey removed. Password + 2FA enabled again.');
      } else {
        addNotification('Failed to remove passkey.');
      }
    } finally {
      setPasskeyBusy(false);
    }
  };

  const handleCreateToken = async () => {
    if (tokenBusy) return;
    const trimmed = tokenLabel.trim();
    if (!trimmed) {
      addNotification('Enter a label for the API token (e.g. laptop-cli).');
      return;
    }

    setTokenBusy(true);
    try {
      const res = await fetch('/api/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201 && typeof data.token === 'string') {
        setTokenLabel('');
        setFreshToken(data.token);
        addNotification('API token created. Copy it now — it will not be shown again.');
        await loadTokensAndUsage();
      } else {
        addNotification(data.message || 'Could not create API token.');
      }
    } finally {
      setTokenBusy(false);
    }
  };

  const handleRevokeToken = async (tok: ApiTokenInfo) => {
    setTokenBusy(true);
    try {
      const res = await fetch(`/api/tokens/${encodeURIComponent(tok.id)}`, { method: 'DELETE' });
      if (res.ok) {
        addNotification('API token revoked.');
        await loadTokensAndUsage();
      } else {
        addNotification('Could not revoke API token.');
      }
    } finally {
      setTokenBusy(false);
    }
  };

  const revokeDevice = async (session: DashboardSessionInfo) => {
    const res = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) {
      addNotification('Failed to sign out device.');
      return;
    }
    if (session.current) {
      await signOut();
      navigate('/login');
      return;
    }
    addNotification('Device signed out.');
    await loadSessions();
  };

  const copyText = (text: string, msg: string) => {
    navigator.clipboard?.writeText(text).then(
      () => addNotification(msg),
      () => addNotification('Could not copy to clipboard')
    );
  };

  const totpQrSvg = useMemo(() => {
    if (!totpSetup?.otpauthUrl) return '';
    try {
      return renderSVG(totpSetup.otpauthUrl, {
        whiteColor: '#e8e8e8',
        blackColor: '#141414',
        border: 2,
      }).replace('<svg ', '<svg width="144" height="144" style="display:block;border-radius:3px;" ');
    } catch {
      return '';
    }
  }, [totpSetup]);

  const startEnableTotp = async () => {
    if (totpBusy) return;
    setTotpBusy(true);
    try {
      const res = await fetch('/api/auth/totp/start', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.otpauthUrl) {
        setTotpSetup({ groupedSecret: data.groupedSecret, otpauthUrl: data.otpauthUrl });
        setTotpCode('');
      } else {
        addNotification(data.message || 'Could not start 2FA setup.');
      }
    } finally {
      setTotpBusy(false);
    }
  };

  const confirmEnableTotp = async () => {
    if (totpBusy || !/^\d{6}$/.test(totpCode.trim())) {
      addNotification('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setTotpBusy(true);
    try {
      const res = await fetch('/api/auth/totp/enable', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpCode.trim() }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setTotpSetup(null);
        setTotpCode('');
        await refreshSession();
        addNotification('Two-factor authentication enabled.');
      } else {
        addNotification(data.message || 'Invalid verification code.');
      }
    } finally {
      setTotpBusy(false);
    }
  };

  const handleDisableTotp = async () => {
    if (totpBusy || isAdmin) return;
    setTotpBusy(true);
    try {
      const res = await fetch('/api/auth/totp', { method: 'DELETE' });
      if (res.ok) {
        await refreshSession();
        addNotification('Two-factor authentication disabled.');
      } else {
        const data = await res.json().catch(() => ({}));
        addNotification(data.message || 'Could not disable 2FA.');
      }
    } finally {
      setTotpBusy(false);
    }
  };

  const cliCurlSnippet = freshToken
    ? `cat file.txt | curl -fsS -H "Authorization: Bearer ${freshToken}" -H "X-TTL: permanent" -H "X-Name: My Snippet" --data-binary @- ${originUrl}/raw`
    : `cat file.txt | curl -fsS --data-binary @- ${originUrl}/raw`;

  return (
    <>
      <div className="cb-panel">
        <span className="cb-section-title">identity & quota</span>
        <div className="cb-kv-row">
          <span className="cb-label">email</span>
          <span>{email}</span>
        </div>
        <div className="cb-kv-row">
          <span className="cb-label">role</span>
          <span className={`cb-tag ${isAdmin ? 'cb-tag--accent' : ''}`}>{role}</span>
        </div>
        {usage && (
          <>
            <div className="cb-kv-row">
              <span className="cb-label">pastes & visibility</span>
              <span>
                {usage.pasteCount}
                {usage.maxPastesPerUser > 0 ? ` / ${usage.maxPastesPerUser}` : ''} total ·{' '}
                {usage.publicCount}
                {usage.maxPublicPastesPerUser ? ` / ${usage.maxPublicPastesPerUser}` : ''} public ·{' '}
                {usage.privateCount}
                {usage.maxPrivatePastesPerUser ? ` / ${usage.maxPrivatePastesPerUser}` : ''} private
              </span>
            </div>
            <div className="cb-kv-row">
              <span className="cb-label">disk usage</span>
              <span>
                {formatBytes(usage.storedBytes)}
                {usage.maxStorageMbPerUser > 0 ? ` / ${usage.maxStorageMbPerUser} MB` : ' (unlimited)'} on disk
              </span>
            </div>
          </>
        )}
        {!isAdmin && permanentDeleteLimit !== null && (
          <div className="cb-kv-row">
            <span className="cb-label">permanent delete cap</span>
            <span>{permanentDeleteLimit} per batch</span>
          </div>
        )}
      </div>

      <div className="cb-panel">
        <div className="cb-section-head">
          <div>
            <span className="cb-section-title">personal api tokens & cli</span>
            <div className="cb-section-sub">
              Pipe logs or files straight from your terminal via POST /raw (only SHA-256 hashes are stored).
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="cb-field" style={{ flex: '1 1 220px' }}>
            <span className="cb-label">token label</span>
            <input
              type="text"
              className="cb-input"
              placeholder="e.g. laptop-cli"
              maxLength={80}
              value={tokenLabel}
              onChange={(e) => setTokenLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void handleCreateToken();
              }}
            />
          </label>
          <Button variant="primary" disabled={tokenBusy} onClick={() => void handleCreateToken()}>
            create token
          </Button>
        </div>

        {freshToken && (
          <div className="cb-notice cb-notice--warn" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>Copy your new API token now — it will never be displayed again:</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                className="cb-input"
                readOnly
                value={freshToken}
                onFocus={(e) => e.target.select()}
              />
              <IconButton label="Copy API token" onClick={() => copyText(freshToken, 'API token copied')}>
                <FiClipboard size={15} />
              </IconButton>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            className="cb-input"
            readOnly
            value={cliCurlSnippet}
            onFocus={(e) => e.target.select()}
            style={{ fontSize: 11, color: '#9e9e9e' }}
          />
          <IconButton label="Copy curl command" onClick={() => copyText(cliCurlSnippet, 'CLI command copied')}>
            <FiClipboard size={15} />
          </IconButton>
        </div>

        {tokens === null ? (
          <div className="cb-section-sub">Loading tokens…</div>
        ) : tokens.length === 0 ? (
          <div className="cb-section-sub">No personal API tokens created yet.</div>
        ) : (
          tokens.map((tok) => (
            <div className="cb-kv-row" key={tok.id}>
              <div>
                <div>
                  {tok.name}{' '}
                  <span style={{ color: '#888', fontSize: 11 }}>({tok.tokenPrefix}…)</span>
                </div>
                <div className="cb-section-sub">
                  created {formatDate(tok.createdAt)} ·{' '}
                  {tok.lastUsedAt ? `last used ${formatDateTime(tok.lastUsedAt)}` : 'never used'}
                </div>
              </div>
              <Button
                size="sm"
                variant="danger"
                disabled={tokenBusy}
                onClick={() =>
                  setConfirm({
                    title: 'revoke api token',
                    description: `Revoke token "${tok.name}" (${tok.tokenPrefix}…)? Scripts using it will stop working immediately.`,
                    confirmLabel: 'Revoke',
                    danger: true,
                    onConfirm: () => {
                      setConfirm(null);
                      void handleRevokeToken(tok);
                    },
                  })
                }
              >
                revoke
              </Button>
            </div>
          ))
        )}
      </div>

      <div className="cb-panel">
        <span className="cb-section-title">authentication</span>

        <div className="cb-kv-row">
          <div>
            <div>passkey (webauthn)</div>
            <div className="cb-section-sub">
              {passkeyRegistered
                ? 'Active · replaces password and TOTP.'
                : 'Not registered · registering disables password login.'}
            </div>
          </div>
          {passkeyRegistered ? (
            <Button size="sm" variant="danger" disabled={passkeyBusy} onClick={() => void removePasskey()}>
              remove passkey
            </Button>
          ) : (
            <Button
              size="sm"
              disabled={passkeyBusy || passkeyRegistered === null}
              onClick={() =>
                setConfirm({
                  title: 'register passkey',
                  description:
                    'Registering a passkey disables password sign-in and removes TOTP 2FA on this account. Continue?',
                  confirmLabel: 'Register',
                  onConfirm: () => {
                    setConfirm(null);
                    void registerPasskey();
                  },
                })
              }
            >
              register passkey
            </Button>
          )}
        </div>

        <div className="cb-kv-row">
          <div>
            <div>two-factor (totp)</div>
            <div className="cb-section-sub">
              {passkeyRegistered
                ? 'Superseded by passkey.'
                : totpEnabled
                  ? isAdmin
                    ? 'Active · mandatory for administrator accounts.'
                    : 'Active on password sign-in.'
                  : isAdmin
                    ? 'Mandatory for administrator accounts.'
                    : 'Off · optional for standard user accounts.'}
            </div>
          </div>
          {!passkeyRegistered && !isAdmin ? (
            totpEnabled ? (
              <Button size="sm" variant="danger" disabled={totpBusy} onClick={() => void handleDisableTotp()}>
                disable 2fa
              </Button>
            ) : (
              <Button size="sm" disabled={totpBusy} onClick={() => void startEnableTotp()}>
                enable 2fa
              </Button>
            )
          ) : (
            <span className={`cb-tag ${!passkeyRegistered && totpEnabled ? 'cb-tag--perm' : ''}`}>
              {passkeyRegistered ? 'off' : totpEnabled ? 'enabled' : 'off'}
            </span>
          )}
        </div>

        {totpSetup && !totpEnabled && !passkeyRegistered && (
          <div className="cb-notice" style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            {totpQrSvg && (
              <div
                aria-label="Authenticator QR code"
                style={{ width: 144, height: 144, lineHeight: 0, flexShrink: 0 }}
                dangerouslySetInnerHTML={{ __html: totpQrSvg }}
              />
            )}
            <div style={{ flex: '1 1 210px', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="cb-section-sub">
                Scan QR or enter secret: <code style={{ color: '#e0e0e0' }}>{totpSetup.groupedSecret}</code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <input
                  type="text"
                  inputMode="numeric"
                  maxLength={6}
                  placeholder="123456"
                  className="cb-input"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  style={{ width: 110, textAlign: 'center', letterSpacing: 2 }}
                />
                <Button variant="primary" size="sm" disabled={totpBusy} onClick={() => void confirmEnableTotp()}>
                  activate
                </Button>
                <Button size="sm" onClick={() => setTotpSetup(null)}>
                  cancel
                </Button>
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="cb-panel">
        <div className="cb-section-head">
          <span className="cb-section-title">active sessions</span>
          <Button
            size="sm"
            variant="danger"
            onClick={async () => {
              await signOut();
              navigate('/login');
            }}
          >
            sign out this device
          </Button>
        </div>

        {sessions === null ? (
          <div className="cb-section-sub">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="cb-section-sub">No active sessions.</div>
        ) : (
          sessions.map((s) => (
            <div className="cb-kv-row" key={s.id}>
              <div>
                <div>
                  {describeUserAgent(s.userAgent)}
                  {s.current ? <span style={{ color: '#90ee90', marginLeft: 8, fontSize: 11 }}>· current</span> : null}
                </div>
                <div className="cb-section-sub">
                  created {formatDateTime(s.createdAt)} · active {formatDateTime(s.lastSeenAt)}
                </div>
              </div>
              <Button
                size="sm"
                onClick={() =>
                  setConfirm({
                    title: 'sign out session',
                    description: s.current
                      ? 'Sign out on this device?'
                      : `Sign out ${describeUserAgent(s.userAgent)}?`,
                    confirmLabel: 'Sign out',
                    danger: true,
                    onConfirm: () => {
                      setConfirm(null);
                      void revokeDevice(s);
                    },
                  })
                }
              >
                revoke
              </Button>
            </div>
          ))
        )}
      </div>

      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
