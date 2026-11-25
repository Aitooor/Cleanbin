import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { startRegistration } from '@simplewebauthn/browser';
import { Button, ConfirmModal, type ConfirmRequest } from '../../components/CleanUi';
import { useNotification } from '../../components/NotificationProvider';
import { useSession } from '../../hooks/useSession';
import { describeUserAgent, formatDateTime } from '../../utils/format';
import type { DashboardSessionInfo } from '../../../shared/types';

export default function AccountPage() {
  const navigate = useNavigate();
  const { email, role, permanentDeleteLimit, signOut } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const [sessions, setSessions] = useState<DashboardSessionInfo[] | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

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
  }, [loadSessions]);

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

  return (
    <>
      <div className="cb-panel">
        <span className="cb-section-title">identity</span>
        <div className="cb-kv-row">
          <span className="cb-label">email</span>
          <span>{email}</span>
        </div>
        <div className="cb-kv-row">
          <span className="cb-label">role</span>
          <span className={`cb-tag ${isAdmin ? 'cb-tag--accent' : ''}`}>{role}</span>
        </div>
        {!isAdmin && permanentDeleteLimit !== null && (
          <div className="cb-kv-row">
            <span className="cb-label">permanent delete cap</span>
            <span>{permanentDeleteLimit} per batch</span>
          </div>
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
                : 'Mandatory on password sign-in.'}
            </div>
          </div>
          <span className={`cb-tag ${passkeyRegistered ? '' : 'cb-tag--perm'}`}>
            {passkeyRegistered ? 'off' : 'enabled'}
          </span>
        </div>
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
