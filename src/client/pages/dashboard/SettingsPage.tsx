import React, { useCallback, useEffect, useState } from 'react';
import { Button } from '../../components/CleanUi';
import { useNotification } from '../../components/NotificationProvider';
import { useSession } from '../../hooks/useSession';
import { formatBytes } from '../../utils/format';
import type { RegistrationMode, StorageStats } from '../../../shared/types';

export default function SettingsPage() {
  const { role } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [compactBusy, setCompactBusy] = useState(false);

  const [regMode, setRegMode] = useState<RegistrationMode>('invite');
  const [requireEmailVerification, setRequireEmailVerification] = useState(false);
  const [mailerConfigured, setMailerConfigured] = useState(false);
  const [defaultCapInput, setDefaultCapInput] = useState('2');
  const [maxPastesInput, setMaxPastesInput] = useState('100');
  const [maxPublicInput, setMaxPublicInput] = useState('0');
  const [maxPrivateInput, setMaxPrivateInput] = useState('25');
  const [maxStorageMbInput, setMaxStorageMbInput] = useState('10');
  const [storage, setStorage] = useState<StorageStats | null>(null);

  const applySettingsPayload = useCallback((data: Record<string, unknown>) => {
    if (data.registrationMode === 'open' || data.registrationMode === 'invite') {
      setRegMode(data.registrationMode);
    }
    if (typeof data.requireEmailVerification === 'boolean') {
      setRequireEmailVerification(data.requireEmailVerification);
    }
    if (typeof data.mailerConfigured === 'boolean') {
      setMailerConfigured(data.mailerConfigured);
    }
    if (typeof data.defaultUserDeleteLimit === 'number') {
      setDefaultCapInput(String(data.defaultUserDeleteLimit));
    }
    if (typeof data.maxPastesPerUser === 'number') {
      setMaxPastesInput(String(data.maxPastesPerUser));
    }
    if (typeof data.maxPublicPastesPerUser === 'number') {
      setMaxPublicInput(String(data.maxPublicPastesPerUser));
    }
    if (typeof data.maxPrivatePastesPerUser === 'number') {
      setMaxPrivateInput(String(data.maxPrivatePastesPerUser));
    }
    if (typeof data.maxStorageMbPerUser === 'number') {
      setMaxStorageMbInput(String(data.maxStorageMbPerUser));
    }
    if (data.storage && typeof data.storage === 'object') {
      setStorage(data.storage as StorageStats);
    }
  }, []);

  const loadSettings = useCallback(async () => {
    if (!isAdmin) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const res = await fetch('/api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const data = await res.json();
      applySettingsPayload(data);
    } finally {
      setLoading(false);
    }
  }, [isAdmin, applySettingsPayload]);

  useEffect(() => {
    void loadSettings();
  }, [loadSettings]);

  if (!isAdmin) {
    return <div className="cb-empty">Administrator role is required to manage instance settings.</div>;
  }

  const savePatch = async (override: Record<string, unknown> = {}, successMsg?: string) => {
    if (busy) return;

    const cap = Number(defaultCapInput);
    const maxPastes = Number(maxPastesInput);
    const maxPublic = Number(maxPublicInput);
    const maxPrivate = Number(maxPrivateInput);
    const maxStorageMb = Number(maxStorageMbInput);

    if (!Number.isInteger(cap) || cap < 0) {
      addNotification('Default permanent delete cap must be an integer >= 0.');
      return;
    }
    if (!Number.isInteger(maxPastes) || maxPastes < 0) {
      addNotification('Max pastes per user must be an integer >= 0 (0 = unlimited).');
      return;
    }
    if (!Number.isInteger(maxPublic) || maxPublic < 0 || !Number.isInteger(maxPrivate) || maxPrivate < 0) {
      addNotification('Public/private limits must be integers >= 0 (0 = unlimited).');
      return;
    }
    if (!Number.isFinite(maxStorageMb) || maxStorageMb < 0) {
      addNotification('Max disk quota per user must be >= 0 MB (0 = unlimited).');
      return;
    }

    setBusy(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          registrationMode: regMode,
          requireEmailVerification,
          defaultUserDeleteLimit: cap,
          maxPastesPerUser: maxPastes,
          maxPublicPastesPerUser: maxPublic,
          maxPrivatePastesPerUser: maxPrivate,
          maxStorageMbPerUser: maxStorageMb,
          ...override,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        applySettingsPayload(data);
        addNotification(successMsg || 'Instance settings saved.');
      } else {
        addNotification((data as { message?: string }).message || 'Failed to save settings.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleCompactStorage = async () => {
    if (compactBusy) return;
    setCompactBusy(true);
    try {
      const res = await fetch('/api/settings/compact', { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.storage) {
        setStorage(data.storage as StorageStats);
        addNotification(
          `Database compacted & vacuumed (${formatBytes((data.storage as StorageStats).storedBytes)} compressed).`
        );
      } else {
        addNotification('Storage compaction failed.');
      }
    } finally {
      setCompactBusy(false);
    }
  };

  if (loading) {
    return <div className="cb-empty">Loading settings…</div>;
  }

  return (
    <>
      <div className="cb-panel">
        <div className="cb-section-head">
          <span className="cb-section-title">registration & anti-spam</span>
          <span className="cb-section-sub">
            {regMode === 'open'
              ? 'Public registration active on /login (2FA mandatory only for admins).'
              : 'Invite-only · only administrators can invite accounts.'}
          </span>
        </div>

        <div className="cb-kv-row">
          <div>
            <div>registration mode</div>
            <div className="cb-section-sub">
              Switch between administrator invitations and public self-registration.
            </div>
          </div>
          <div className="cb-tabs" style={{ borderBottom: 'none', paddingBottom: 0 }}>
            <button
              type="button"
              className={`cb-tab ${regMode === 'invite' ? 'cb-tab--active' : ''}`.trim()}
              disabled={busy}
              onClick={() =>
                void savePatch(
                  { registrationMode: 'invite' },
                  'Registration set to invite-only.'
                )
              }
            >
              invite only
            </button>
            <button
              type="button"
              className={`cb-tab ${regMode === 'open' ? 'cb-tab--active' : ''}`.trim()}
              disabled={busy}
              onClick={() =>
                void savePatch(
                  { registrationMode: 'open' },
                  'Open registration enabled.'
                )
              }
            >
              open registration
            </button>
          </div>
        </div>

        <div className="cb-kv-row">
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>require email verification</span>
              <span className={`cb-tag ${mailerConfigured ? 'cb-tag--perm' : 'cb-tag--warn'}`}>
                {mailerConfigured ? 'resend ready' : 'mailer not configured'}
              </span>
            </div>
            <div className="cb-section-sub">
              {mailerConfigured
                ? 'When enabled, public sign-ups receive a one-time email link before activating 2FA.'
                : 'Set RESEND_API_KEY and MAIL_FROM on the server to enable email verification.'}
            </div>
          </div>
          <input
            type="checkbox"
            aria-label="Require email verification"
            className="cb-checkbox"
            checked={requireEmailVerification}
            disabled={busy || (!mailerConfigured && !requireEmailVerification)}
            onChange={(e) => {
              const next = e.target.checked;
              setRequireEmailVerification(next);
              void savePatch(
                { requireEmailVerification: next },
                next ? 'Email verification enabled for open sign-ups.' : 'Email verification disabled.'
              );
            }}
          />
        </div>
      </div>

      <div className="cb-panel">
        <div className="cb-section-head">
          <span className="cb-section-title">user quotas & limits</span>
          <span className="cb-section-sub">
            Applies to standard user accounts (0 = unlimited). Administrators are never capped.
          </span>
        </div>

        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <label className="cb-field" style={{ flex: '1 1 150px' }}>
            <span className="cb-label">max total pastes</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={maxPastesInput}
              onChange={(e) => setMaxPastesInput(e.target.value)}
            />
          </label>

          <label className="cb-field" style={{ flex: '1 1 150px' }}>
            <span className="cb-label">max public pastes</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={maxPublicInput}
              onChange={(e) => setMaxPublicInput(e.target.value)}
            />
          </label>

          <label className="cb-field" style={{ flex: '1 1 150px' }}>
            <span className="cb-label">max private pastes</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={maxPrivateInput}
              onChange={(e) => setMaxPrivateInput(e.target.value)}
            />
          </label>

          <label className="cb-field" style={{ flex: '1 1 170px' }}>
            <span className="cb-label">max disk (MB compressed)</span>
            <input
              type="number"
              min={0}
              step="0.5"
              className="cb-input"
              value={maxStorageMbInput}
              onChange={(e) => setMaxStorageMbInput(e.target.value)}
            />
          </label>

          <label className="cb-field" style={{ flex: '1 1 150px' }}>
            <span className="cb-label">default perm delete cap</span>
            <input
              type="number"
              min={0}
              className="cb-input"
              value={defaultCapInput}
              onChange={(e) => setDefaultCapInput(e.target.value)}
            />
          </label>

          <Button variant="primary" disabled={busy} onClick={() => void savePatch()}>
            Save quotas
          </Button>
        </div>
      </div>

      <div className="cb-panel">
        <div className="cb-section-head">
          <div>
            <span className="cb-section-title">disk footprint & compression</span>
            <div className="cb-section-sub">
              Pastes are stored as pure Brotli-11 text streams without JSON metadata or Base64 inflation.
            </div>
          </div>
          <Button disabled={compactBusy} onClick={() => void handleCompactStorage()}>
            {compactBusy ? 'compacting…' : 'compact & vacuum db'}
          </Button>
        </div>

        {storage && (
          <div className="cb-stats">
            <div className="cb-stat">
              <span className="cb-stat-label">stored pastes</span>
              <span className="cb-stat-val">{storage.pasteCount}</span>
            </div>
            <div className="cb-stat">
              <span className="cb-stat-label">raw text size</span>
              <span className="cb-stat-val">{formatBytes(storage.rawBytes)}</span>
            </div>
            <div className="cb-stat">
              <span className="cb-stat-label">compressed payload</span>
              <span className="cb-stat-val cb-stat-val--perm">
                {formatBytes(storage.storedBytes)}
                {storage.savingsPercent > 0 ? (
                  <span style={{ fontSize: 11, marginLeft: 6, color: '#90ee90' }}>
                    (-{storage.savingsPercent}%)
                  </span>
                ) : null}
              </span>
            </div>
            {storage.dbFileBytes !== null && (
              <div className="cb-stat">
                <span className="cb-stat-label">sqlite db on disk</span>
                <span className="cb-stat-val">{formatBytes(storage.dbFileBytes)}</span>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}
