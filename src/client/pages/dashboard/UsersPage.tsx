import React, { useCallback, useEffect, useState } from 'react';
import { FiClipboard, FiEdit2, FiRefreshCw, FiShield, FiTrash2 } from 'react-icons/fi';
import { Button, ConfirmModal, type ConfirmRequest, IconButton, Modal } from '../../components/CleanUi';
import { useNotification } from '../../components/NotificationProvider';
import { useSession } from '../../hooks/useSession';
import { formatDate } from '../../utils/format';
import type { DashboardUser, RegistrationMode, SessionRole } from '../../../shared/types';

export default function UsersPage() {
  const { role } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [regMode, setRegMode] = useState<RegistrationMode>('invite');
  const [defaultCapInput, setDefaultCapInput] = useState('2');
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [email, setEmail] = useState('');
  const [newRole, setNewRole] = useState<SessionRole>('user');
  const [limitInput, setLimitInput] = useState('2');
  const [busy, setBusy] = useState(false);
  const [setupUrl, setSetupUrl] = useState<string | null>(null);

  const [editTarget, setEditTarget] = useState<DashboardUser | null>(null);
  const [editRole, setEditRole] = useState<SessionRole>('user');
  const [editLimit, setEditLimit] = useState('0');
  const [editPassword, setEditPassword] = useState('');
  const [resetUrl, setResetUrl] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

  const fetchUsers = useCallback(async (): Promise<DashboardUser[]> => {
    if (!isAdmin) {
      setLoading(false);
      return [];
    }
    setLoading(true);
    try {
      const res = await fetch('/api/users');
      if (!res.ok) return [];
      const data: DashboardUser[] = await res.json();
      setUsers(data);
      return data;
    } finally {
      setLoading(false);
    }
  }, [isAdmin]);

  useEffect(() => {
    void fetchUsers();
  }, [fetchUsers]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetch('/api/settings')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (!active || !data) return;
        if (data.registrationMode === 'open' || data.registrationMode === 'invite') {
          setRegMode(data.registrationMode);
        }
        if (typeof data.defaultUserDeleteLimit === 'number') {
          setDefaultCapInput(String(data.defaultUserDeleteLimit));
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isAdmin]);

  const handleSaveSettings = async (nextMode?: RegistrationMode) => {
    if (settingsBusy) return;
    const cap = Number(defaultCapInput);
    if (!Number.isInteger(cap) || cap < 0) {
      addNotification('Default permanent delete cap must be >= 0.');
      return;
    }
    const modeToSave = nextMode ?? regMode;
    setSettingsBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationMode: modeToSave,
          defaultUserDeleteLimit: cap,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setRegMode(data.registrationMode ?? modeToSave);
        if (typeof data.defaultUserDeleteLimit === 'number') {
          setDefaultCapInput(String(data.defaultUserDeleteLimit));
        }
        addNotification(
          modeToSave === 'open'
            ? 'Registration set to open (new accounts still require 2FA).'
            : 'Registration set to invite-only.'
        );
      } else {
        addNotification(data.message || 'Failed to save registration settings.');
      }
    } finally {
      setSettingsBusy(false);
    }
  };

  if (!isAdmin) {
    return <div className="cb-empty">Administrator role is required to manage accounts.</div>;
  }

  const handleInvite = async () => {
    if (busy) return;
    const limit = Number(limitInput);
    if (!Number.isInteger(limit) || limit < 0) {
      addNotification('Permanent delete limit must be >= 0.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(email.trim())) {
      addNotification('Enter a valid email.');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim(),
          role: newRole,
          permanentDeleteLimit: limit,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 201) {
        setEmail('');
        if (data.setupUrl) {
          setSetupUrl(data.setupUrl);
          addNotification('Account created. Copy manual setup link below.');
        } else {
          setSetupUrl(null);
          addNotification('Invitation email sent.');
        }
        await fetchUsers();
      } else {
        addNotification(data.message || 'Failed to invite user.');
      }
    } finally {
      setBusy(false);
    }
  };

  const openEdit = (u: DashboardUser) => {
    setResetUrl(null);
    setEditTarget(u);
    setEditRole(u.role);
    setEditLimit(String(u.permanentDeleteLimit));
    setEditPassword('');
  };

  const handleSaveEdit = async () => {
    if (!editTarget || busy) return;
    const limit = Number(editLimit);
    if (!Number.isInteger(limit) || limit < 0) {
      addNotification('Limit must be >= 0.');
      return;
    }
    const patch: Record<string, unknown> = { role: editRole, permanentDeleteLimit: limit };
    if (editPassword) patch.password = editPassword;

    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(editTarget.email)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        addNotification('Account updated');
        setEditTarget(null);
        await fetchUsers();
      } else {
        addNotification(data.message || 'Failed to update account');
      }
    } finally {
      setBusy(false);
    }
  };

  const runUserAction = async (targetEmail: string, action: string, okMsg: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(targetEmail)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        if (data.setupUrl) {
          if (action === 'resend-invite') setSetupUrl(data.setupUrl);
          else setResetUrl(data.setupUrl);
          addNotification('Link generated (email not configured). Copy it below.');
        } else {
          addNotification(okMsg);
        }
        const list = await fetchUsers();
        setEditTarget((cur) => (cur ? list.find((u) => u.email === cur.email) ?? cur : cur));
      } else {
        addNotification(data.message || 'Action failed');
      }
    } finally {
      setBusy(false);
    }
  };

  const performDelete = async (targetEmail: string) => {
    setBusy(true);
    try {
      const res = await fetch(`/api/users/${encodeURIComponent(targetEmail)}`, { method: 'DELETE' });
      if (res.ok) {
        addNotification('Account deleted');
        if (editTarget?.email === targetEmail) setEditTarget(null);
        await fetchUsers();
      } else {
        const data = await res.json().catch(() => ({}));
        addNotification(data.message || 'Failed to delete account');
      }
    } finally {
      setBusy(false);
    }
  };

  const copyLink = (url: string) => {
    navigator.clipboard?.writeText(url).then(
      () => addNotification('Link copied'),
      () => addNotification('Could not copy link')
    );
  };

  return (
    <>
      <div className="cb-panel">
        <div className="cb-section-head">
          <span className="cb-section-title">registration access</span>
          <span className="cb-section-sub">
            {regMode === 'open'
              ? 'Open registration enabled on /login (mandatory 2FA setup on first sign-in).'
              : 'Invite-only · only administrators can create accounts.'}
          </span>
        </div>

        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <div className="cb-field">
            <span className="cb-label">mode</span>
            <div className="cb-tabs" style={{ marginBottom: 0 }}>
              <button
                type="button"
                className={`cb-tab ${regMode === 'invite' ? 'cb-tab--active' : ''}`.trim()}
                disabled={settingsBusy}
                onClick={() => void handleSaveSettings('invite')}
              >
                invite only
              </button>
              <button
                type="button"
                className={`cb-tab ${regMode === 'open' ? 'cb-tab--active' : ''}`.trim()}
                disabled={settingsBusy}
                onClick={() => void handleSaveSettings('open')}
              >
                open registration
              </button>
            </div>
          </div>

          <label className="cb-field" style={{ width: 150 }}>
            <span className="cb-label">default perm delete cap</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={defaultCapInput}
              onChange={(e) => setDefaultCapInput(e.target.value)}
            />
          </label>

          <Button disabled={settingsBusy} onClick={() => void handleSaveSettings()}>
            Save cap
          </Button>
        </div>
      </div>

      <div className="cb-panel">
        <div className="cb-section-head">
          <span className="cb-section-title">invite account</span>
          <span className="cb-section-sub">Invitee sets password + mandatory 2FA via one-time link.</span>
        </div>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="cb-field" style={{ flex: '1 1 220px' }}>
            <span className="cb-label">email</span>
            <input
              type="email"
              className="cb-input"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>

          <label className="cb-field">
            <span className="cb-label">role</span>
            <select
              className="cb-select"
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as SessionRole)}
            >
              <option value="user">user</option>
              <option value="admin">admin</option>
            </select>
          </label>

          <label className="cb-field" style={{ width: 110 }}>
            <span className="cb-label">perm delete cap</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={limitInput}
              onChange={(e) => setLimitInput(e.target.value)}
            />
          </label>

          <Button variant="primary" disabled={busy} onClick={() => void handleInvite()}>
            Invite
          </Button>
        </div>

        {setupUrl && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input className="cb-input" readOnly value={setupUrl} onFocus={(e) => e.target.select()} />
            <IconButton label="Copy setup link" onClick={() => copyLink(setupUrl)}>
              <FiClipboard size={15} />
            </IconButton>
          </div>
        )}
      </div>

      {loading ? (
        <div className="cb-empty">Loading accounts…</div>
      ) : (
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr>
                <th>email</th>
                <th>role</th>
                <th>cap</th>
                <th>status</th>
                <th>2fa</th>
                <th>passkey</th>
                <th>created</th>
                <th className="cb-right" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.email}>
                  <td>
                    {u.email}
                    {u.immutable ? <span style={{ color: '#666' }}> (env)</span> : null}
                  </td>
                  <td>
                    <span className={`cb-tag ${u.role === 'admin' ? 'cb-tag--accent' : ''}`}>
                      {u.role}
                    </span>
                  </td>
                  <td style={{ color: '#888' }}>{u.role === 'admin' ? '∞' : u.permanentDeleteLimit}</td>
                  <td>
                    <span className={`cb-tag ${u.status === 'invited' ? 'cb-tag--warn' : ''}`}>
                      {u.status}
                    </span>
                  </td>
                  <td>
                    <span className={`cb-tag ${u.totpEnabled ? 'cb-tag--perm' : ''}`}>
                      {u.totpEnabled ? 'on' : 'off'}
                    </span>
                  </td>
                  <td>
                    <span className={`cb-tag ${u.hasPasskey ? 'cb-tag--perm' : ''}`}>
                      {u.hasPasskey ? 'yes' : '—'}
                    </span>
                  </td>
                  <td style={{ color: '#666' }}>{formatDate(u.createdAt)}</td>
                  <td className="cb-right">
                    <span className="cb-row-actions">
                      {u.invitePending && !u.immutable && (
                        <IconButton
                          label="Resend invite"
                          size="sm"
                          disabled={busy}
                          onClick={() => void runUserAction(u.email, 'resend-invite', 'Invite resent')}
                        >
                          <FiRefreshCw size={14} />
                        </IconButton>
                      )}
                      {u.totpEnabled && (
                        <IconButton
                          label="Reset 2FA"
                          size="sm"
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: 'reset 2fa',
                              description: `Reset two-factor authentication for ${u.email}?`,
                              confirmLabel: 'Reset 2FA',
                              danger: true,
                              onConfirm: () => {
                                setConfirm(null);
                                void runUserAction(u.email, 'reset-2fa', '2FA reset');
                              },
                            })
                          }
                        >
                          <FiShield size={14} />
                        </IconButton>
                      )}
                      <IconButton label="Edit" size="sm" onClick={() => openEdit(u)}>
                        <FiEdit2 size={14} />
                      </IconButton>
                      {!u.immutable && (
                        <IconButton
                          label="Delete"
                          size="sm"
                          danger
                          disabled={busy}
                          onClick={() =>
                            setConfirm({
                              title: 'delete account',
                              description: `Delete account ${u.email}?`,
                              confirmLabel: 'Delete',
                              danger: true,
                              onConfirm: () => {
                                setConfirm(null);
                                void performDelete(u.email);
                              },
                            })
                          }
                        >
                          <FiTrash2 size={14} />
                        </IconButton>
                      )}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {editTarget && (
        <Modal
          title={`account · ${editTarget.email}`}
          onClose={() => setEditTarget(null)}
          footer={
            editTarget.immutable ? (
              <Button onClick={() => setEditTarget(null)}>Close</Button>
            ) : (
              <>
                <Button onClick={() => setEditTarget(null)}>Cancel</Button>
                <Button variant="primary" disabled={busy} onClick={() => void handleSaveEdit()}>
                  Save
                </Button>
              </>
            )
          }
        >
          {!editTarget.immutable ? (
            <>
              <label className="cb-field">
                <span className="cb-label">role</span>
                <select
                  className="cb-select"
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value as SessionRole)}
                >
                  <option value="user">user</option>
                  <option value="admin">admin</option>
                </select>
              </label>

              <label className="cb-field">
                <span className="cb-label">permanent delete limit</span>
                <input
                  type="number"
                  min={0}
                  className="cb-input"
                  value={editLimit}
                  onChange={(e) => setEditLimit(e.target.value)}
                />
              </label>

              <label className="cb-field">
                <span className="cb-label">set password directly (optional)</span>
                <input
                  type="password"
                  className="cb-input"
                  placeholder="leave empty to keep current"
                  value={editPassword}
                  onChange={(e) => setEditPassword(e.target.value)}
                />
              </label>
              <hr className="cb-divider" />
            </>
          ) : (
            <div className="cb-notice">
              Environment admin role and limits are fixed via env vars. Recovery actions below remain available.
            </div>
          )}

          <div className="cb-kv-row">
            <div>
              <div>passkey</div>
              <div className="cb-section-sub">Removing passkey restores password + 2FA login.</div>
            </div>
            <Button
              size="sm"
              variant="danger"
              disabled={busy || !editTarget.hasPasskey}
              onClick={() => void runUserAction(editTarget.email, 'remove-passkey', 'Passkey removed')}
            >
              remove passkey
            </Button>
          </div>

          <div className="cb-kv-row">
            <div>
              <div>two-factor (totp)</div>
              <div className="cb-section-sub">Forces new 2FA setup on next sign-in.</div>
            </div>
            <Button
              size="sm"
              disabled={busy || !editTarget.totpEnabled}
              onClick={() => void runUserAction(editTarget.email, 'reset-2fa', '2FA reset')}
            >
              reset 2fa
            </Button>
          </div>

          <div className="cb-kv-row">
            <div>
              <div>password recovery</div>
              <div className="cb-section-sub">Revokes sessions, clears 2FA/passkey, issues setup link.</div>
            </div>
            <Button
              size="sm"
              disabled={busy}
              onClick={() => void runUserAction(editTarget.email, 'reset-password', 'Reset link sent')}
            >
              reset password
            </Button>
          </div>

          {resetUrl && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="cb-input" readOnly value={resetUrl} onFocus={(e) => e.target.select()} />
              <IconButton label="Copy reset link" onClick={() => copyLink(resetUrl)}>
                <FiClipboard size={15} />
              </IconButton>
            </div>
          )}
        </Modal>
      )}

      {confirm && <ConfirmModal {...confirm} busy={busy} onClose={() => setConfirm(null)} />}
    </>
  );
}
