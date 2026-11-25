import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  FiClipboard,
  FiCopy,
  FiEdit2,
  FiEye,
  FiFilter,
  FiShare2,
  FiTrash2,
  FiX,
} from 'react-icons/fi';
import BulkDeleteModal, { type BulkDeleteMode } from '../../components/BulkDeleteModal';
import { Button, ConfirmModal, type ConfirmRequest, IconButton, Modal } from '../../components/CleanUi';
import FiltersBar from '../../components/FiltersBar';
import { useNotification } from '../../components/NotificationProvider';
import { usePastes } from '../../hooks/usePastes';
import { useSession } from '../../hooks/useSession';
import { listenBroadcast, postBroadcast } from '../../utils/broadcast';
import { formatDateTime } from '../../utils/format';
import type {
  DashboardUser,
  ListedPaste,
  PasteFilterRule,
  PasteListQuery,
  PasteMatchMode,
  PasteScope,
  PasteSortDir,
  PasteSortField,
} from '../../../shared/types';

type SortValue = 'default' | 'createdAt:asc' | 'name:asc' | 'name:desc';

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
  { value: 'default', label: 'newest first' },
  { value: 'createdAt:asc', label: 'oldest first' },
  { value: 'name:asc', label: 'name a→z' },
  { value: 'name:desc', label: 'name z→a' },
];

type EditState = {
  id: string;
  name: string;
  content: string;
  version: number;
  updatedAt?: string;
  saving: boolean;
  conflict: boolean;
  error: string | null;
  conflictName?: string;
  conflictContent?: string;
  conflictVersion?: number;
};

type ShareState = {
  id: string;
  list: string[];
  email: string;
  busy: boolean;
};

const PRESENCE_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 280;

function decodeSort(value: SortValue): { sort: PasteSortField | null; dir: PasteSortDir } {
  if (value === 'default') return { sort: null, dir: 'desc' };
  const [field, dir] = value.split(':');
  return { sort: field as PasteSortField, dir: dir as PasteSortDir };
}

export default function PastesPage() {
  const navigate = useNavigate();
  const { role } = useSession();
  const { addNotification } = useNotification();
  const isAdmin = role === 'admin';

  const [scope, setScope] = useState<PasteScope>(isAdmin ? 'all' : 'default');
  const [searchInput, setSearchInput] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [sortValue, setSortValue] = useState<SortValue>('default');
  const [showFilters, setShowFilters] = useState(false);
  const [draftRules, setDraftRules] = useState<PasteFilterRule[]>([]);
  const [activeRules, setActiveRules] = useState<PasteFilterRule[]>([]);
  const [matchMode, setMatchMode] = useState<PasteMatchMode>('AND');

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const listQuery = useMemo<PasteListQuery>(() => {
    const { sort, dir } = decodeSort(sortValue);
    return { scope, query: debouncedQuery, filterRules: activeRules, matchMode, sort, dir };
  }, [scope, debouncedQuery, activeRules, matchMode, sortValue]);

  const { items, total, page, totalPages, loading, error, setPage, refresh, removeIds, updatePaste } =
    usePastes(50, listQuery);

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteMode, setDeleteMode] = useState<BulkDeleteMode | null>(null);
  const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);
  const [editing, setEditing] = useState<EditState | null>(null);
  const [sharing, setSharing] = useState<ShareState | null>(null);
  const [users, setUsers] = useState<DashboardUser[]>([]);
  const [presence, setPresence] = useState<Record<string, string[]>>({});

  const allSelected = items.length > 0 && items.every((p) => selectedIds.has(p.id));

  const selectionKey = `${page}|${JSON.stringify(listQuery)}`;
  useEffect(() => {
    setSelectedIds(new Set());
  }, [selectionKey]);

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    fetch('/api/users')
      .then((res) => (res.ok ? res.json() : []))
      .then((list) => {
        if (active && Array.isArray(list)) setUsers(list);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [isAdmin]);

  useEffect(() => {
    return listenBroadcast((msg) => {
      if (msg && msg.type?.startsWith('paste')) refresh();
    });
  }, [refresh]);

  const pageIds = useMemo(() => items.map((p) => p.id), [items]);
  useEffect(() => {
    if (pageIds.length === 0) {
      setPresence({});
      return;
    }
    let active = true;
    const poll = async () => {
      if (document.visibilityState === 'hidden') return;
      try {
        const res = await fetch(`/api/pastes/presence?ids=${encodeURIComponent(pageIds.join(','))}`);
        if (!res.ok) return;
        const body = await res.json();
        if (active && body && typeof body.editors === 'object') setPresence(body.editors);
      } catch {
        // Best effort
      }
    };
    void poll();
    const interval = window.setInterval(poll, PRESENCE_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [pageIds]);

  const editingId = editing?.id ?? null;
  useEffect(() => {
    if (!editingId) return;
    let active = true;
    const beat = async () => {
      try {
        const res = await fetch(`/api/paste/${editingId}/presence`, { method: 'POST' });
        if (!res.ok) return;
        const body = await res.json();
        if (active && Array.isArray(body.editors)) {
          setPresence((prev) => ({ ...prev, [editingId]: body.editors }));
        }
      } catch {
        // Best effort
      }
    };
    void beat();
    const interval = window.setInterval(beat, PRESENCE_POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [editingId]);

  const copyText = useCallback(
    (value: string, message: string) => {
      navigator.clipboard?.writeText(value).then(
        () => addNotification(message),
        () => addNotification('Could not copy')
      );
    },
    [addNotification]
  );

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const clearFilters = () => {
    setSearchInput('');
    setDebouncedQuery('');
    setSortValue('default');
    setDraftRules([]);
    setActiveRules([]);
    setMatchMode('AND');
  };

  const openEdit = (paste: ListedPaste) => {
    setEditing({
      id: paste.id,
      name: paste.name || '',
      content: paste.content || '',
      version: typeof paste.version === 'number' ? paste.version : 0,
      updatedAt: paste.updatedAt,
      saving: false,
      conflict: false,
      error: null,
    });
    fetch(`/api/paste/${paste.id}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((body) => {
        if (!body) return;
        setEditing((prev) =>
          prev && prev.id === paste.id
            ? {
                ...prev,
                name: body.name ?? prev.name,
                content: body.content ?? prev.content,
                version: body.version ?? prev.version,
                updatedAt: body.updatedAt ?? prev.updatedAt,
              }
            : prev
        );
      })
      .catch(() => {});
  };

  const saveEdit = async (overrideVersion?: number) => {
    if (!editing) return;
    setEditing((prev) => (prev ? { ...prev, saving: true, error: null } : prev));
    const response = await fetch(`/api/paste/${editing.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: editing.name,
        content: editing.content,
        version: overrideVersion ?? editing.version,
      }),
    });

    if (response.status === 409) {
      const body = await response.json().catch(() => ({}));
      const serverPaste = body?.paste;
      setEditing((prev) =>
        prev
          ? {
              ...prev,
              saving: false,
              conflict: true,
              error: body?.error || 'Someone else modified this paste.',
              conflictVersion: serverPaste?.version,
              conflictName: serverPaste?.name,
              conflictContent: serverPaste?.content,
            }
          : prev
      );
      return;
    }

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      setEditing((prev) =>
        prev ? { ...prev, saving: false, error: body?.message || 'Failed to save paste.' } : prev
      );
      return;
    }

    const body = await response.json().catch(() => ({}));
    const saved = body?.paste;
    if (saved) {
      updatePaste(editing.id, {
        name: saved.name,
        content: saved.content,
        version: saved.version,
        updatedAt: saved.updatedAt,
        owner: saved.owner,
        sharedWith: saved.sharedWith,
      });
    }
    addNotification('Paste saved');
    postBroadcast({ type: 'paste_updated', id: editing.id });
    setEditing(null);
  };

  const performDeletePaste = async (paste: ListedPaste) => {
    const res = await fetch(`/api/paste/${paste.id}`, { method: 'DELETE' });
    if (res.ok) {
      removeIds([paste.id]);
      addNotification('Paste deleted');
      postBroadcast({ type: 'paste_deleted', id: paste.id });
    } else {
      addNotification('Failed to delete paste');
    }
  };

  const changeShare = async (email: string, action: 'add' | 'remove') => {
    if (!sharing) return;
    setSharing((prev) => (prev ? { ...prev, busy: true } : prev));
    const res = await fetch(`/api/paste/${sharing.id}/share`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, action }),
    });
    const body = await res.json().catch(() => ({}));
    if (res.ok && Array.isArray(body.sharedWith)) {
      setSharing((prev) => (prev ? { ...prev, list: body.sharedWith, email: '', busy: false } : prev));
      updatePaste(sharing.id, { sharedWith: body.sharedWith });
      addNotification(action === 'add' ? 'Collaborator added' : 'Collaborator removed');
    } else {
      setSharing((prev) => (prev ? { ...prev, busy: false } : prev));
      addNotification(body.message || 'Failed to update access');
    }
  };

  const scopeOptions: Array<{ value: PasteScope; label: string }> = isAdmin
    ? [
        { value: 'all', label: 'all pastes' },
        { value: 'mine', label: 'mine' },
        { value: 'shared', label: 'shared with me' },
        { value: 'anonymous', label: 'anonymous' },
      ]
    : [
        { value: 'default', label: 'mine & shared' },
        { value: 'mine', label: 'only mine' },
        { value: 'shared', label: 'shared with me' },
      ];

  const hasFilters = debouncedQuery.length > 0 || activeRules.length > 0 || sortValue !== 'default';

  return (
    <>
      <div className="cb-toolbar">
        <input
          type="search"
          className="cb-input cb-toolbar-search"
          placeholder="search name, content, owner, uuid…"
          value={searchInput}
          onChange={(e) => setSearchInput(e.target.value)}
        />

        <select
          className="cb-select"
          value={scope}
          onChange={(e) => setScope(e.target.value as PasteScope)}
          aria-label="Ownership scope"
        >
          {scopeOptions.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <select
          className="cb-select"
          value={sortValue}
          onChange={(e) => setSortValue(e.target.value as SortValue)}
          aria-label="Sort order"
        >
          {SORT_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <Button
          onClick={() => {
            setDraftRules(activeRules);
            setShowFilters((p) => !p);
          }}
        >
          <FiFilter size={13} />
          filters{activeRules.length > 0 ? ` (${activeRules.length})` : ''}
        </Button>

        <div className="cb-toolbar-end">
          <span className="cb-section-sub">
            {selectedIds.size > 0 ? `${selectedIds.size} selected` : `${total} total`}
          </span>
          <Button
            variant="danger"
            disabled={total === 0}
            onClick={() => {
              const mode: BulkDeleteMode =
                selectedIds.size > 0
                  ? 'selected'
                  : debouncedQuery || activeRules.length > 0
                    ? 'filtered'
                    : 'all';
              setDeleteMode(mode);
            }}
          >
            <FiTrash2 size={13} />
            delete…
          </Button>
        </div>
      </div>

      {hasFilters && (
        <div className="cb-chips">
          {debouncedQuery && (
            <span className="cb-chip">
              q: {debouncedQuery}
              <button type="button" onClick={() => setSearchInput('')} aria-label="Remove search">
                <FiX size={12} />
              </button>
            </span>
          )}
          {activeRules.map((r, i) => (
            <span className="cb-chip" key={i}>
              {r.negate ? 'not ' : ''}
              {r.field} {r.op} "{r.value}"
              <button
                type="button"
                onClick={() => setActiveRules((prev) => prev.filter((_, idx) => idx !== i))}
                aria-label="Remove rule"
              >
                <FiX size={12} />
              </button>
            </span>
          ))}
          <Button size="sm" onClick={clearFilters}>
            clear all
          </Button>
        </div>
      )}

      {showFilters && (
        <FiltersBar
          rules={draftRules}
          matchMode={matchMode}
          onRulesChange={setDraftRules}
          onMatchModeChange={setMatchMode}
          onApply={() => {
            setActiveRules(draftRules.filter((r) => r.value.trim().length > 0));
            setShowFilters(false);
          }}
          onClear={() => {
            setDraftRules([]);
            setActiveRules([]);
          }}
        />
      )}

      {error && <div className="cb-notice cb-notice--danger">{error}</div>}

      {loading ? (
        <div className="cb-empty">Loading pastes…</div>
      ) : items.length === 0 ? (
        <div className="cb-empty">
          {hasFilters ? 'No pastes match the active filters.' : 'No pastes yet.'}
        </div>
      ) : (
        <div className="cb-table-wrap">
          <table className="cb-table">
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    className="cb-checkbox"
                    checked={allSelected}
                    onChange={(e) =>
                      setSelectedIds(e.target.checked ? new Set(items.map((p) => p.id)) : new Set())
                    }
                    aria-label="Select page"
                  />
                </th>
                <th>name</th>
                <th>owner</th>
                <th>uuid</th>
                <th>type</th>
                <th>created</th>
                <th className="cb-right" />
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id}>
                  <td>
                    <input
                      type="checkbox"
                      className="cb-checkbox"
                      checked={selectedIds.has(row.id)}
                      onChange={() => toggleSelect(row.id)}
                      aria-label={`Select ${row.name || row.id}`}
                    />
                  </td>
                  <td>
                    {presence[row.id]?.length ? (
                      <span
                        className="cb-presence-dot"
                        title={`Editing now: ${presence[row.id].join(', ')}`}
                      />
                    ) : null}
                    <span className="cb-truncate">{row.name || 'untitled'}</span>
                  </td>
                  <td style={{ color: row.mine ? '#e0e0e0' : '#666' }}>
                    {row.mine ? 'you' : row.owner || 'anon'}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="cb-id-btn"
                      title={`Copy ${row.id}`}
                      onClick={() => copyText(row.id, 'UUID copied')}
                    >
                      {row.id.slice(0, 8)}
                    </button>
                  </td>
                  <td>
                    <span
                      className={`cb-tag ${
                        row.permanent ? 'cb-tag--perm' : row.burnAfterRead ? 'cb-tag--warn' : ''
                      }`}
                    >
                      {row.permanent ? 'perm' : row.burnAfterRead ? '1 read' : 'temp'}
                    </span>
                  </td>
                  <td style={{ color: '#666', whiteSpace: 'nowrap' }}>{formatDateTime(row.createdAt)}</td>
                  <td className="cb-right">
                    <span className="cb-row-actions">
                      <IconButton
                        label="Open"
                        size="sm"
                        onClick={() =>
                          window.open(
                            import.meta.env.VITE_DEMO_MODE === '1'
                              ? `${import.meta.env.BASE_URL}#/${row.id}`
                              : `/${row.id}`,
                            '_blank'
                          )
                        }
                      >
                        <FiEye size={14} />
                      </IconButton>
                      <IconButton
                        label="Copy URL"
                        size="sm"
                        onClick={() =>
                          copyText(
                            import.meta.env.VITE_DEMO_MODE === '1'
                              ? `${window.location.origin}${import.meta.env.BASE_URL}#/${row.id}`
                              : `${window.location.origin}/${row.id}`,
                            'URL copied'
                          )
                        }
                      >
                        <FiClipboard size={14} />
                      </IconButton>
                      <IconButton
                        label="Clone"
                        size="sm"
                        onClick={() => navigate(`/clone/${row.id}`)}
                      >
                        <FiCopy size={14} />
                      </IconButton>
                      <IconButton label="Share" size="sm" onClick={() => setSharing({ id: row.id, list: row.sharedWith ?? [], email: '', busy: false })}>
                        <FiShare2 size={14} />
                      </IconButton>
                      <IconButton label="Edit" size="sm" onClick={() => openEdit(row)}>
                        <FiEdit2 size={14} />
                      </IconButton>
                      <IconButton
                        label="Delete"
                        size="sm"
                        danger
                        onClick={() =>
                          setConfirm({
                            title: 'delete paste',
                            description: `Delete "${row.name || row.id}"? This cannot be undone.`,
                            confirmLabel: 'Delete',
                            danger: true,
                            onConfirm: () => {
                              setConfirm(null);
                              void performDeletePaste(row);
                            },
                          })
                        }
                      >
                        <FiTrash2 size={14} />
                      </IconButton>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="cb-pagination">
        <span>
          page {page} of {totalPages}
        </span>
        <Button size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          prev
        </Button>
        <Button size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          next
        </Button>
      </div>

      {deleteMode && (
        <BulkDeleteModal
          defaultMode={deleteMode}
          selectedIds={Array.from(selectedIds)}
          selectedRows={items.filter((p) => selectedIds.has(p.id))}
          scope={scope}
          query={debouncedQuery}
          filterRules={activeRules}
          matchMode={matchMode}
          onClose={() => setDeleteMode(null)}
          onDeleted={(ids) => {
            removeIds(ids);
            setSelectedIds(new Set());
            refresh();
            addNotification(`Deleted ${ids.length} paste${ids.length === 1 ? '' : 's'}`);
            postBroadcast({ type: 'pastes_bulk_deleted', ids });
          }}
        />
      )}

      {editing && (
        <Modal
          title={`edit · ${editing.name || editing.id.slice(0, 8)}`}
          wide
          onClose={() => setEditing(null)}
          footer={
            <>
              <Button onClick={() => setEditing(null)}>Cancel</Button>
              <Button variant="primary" disabled={editing.saving} onClick={() => void saveEdit()}>
                {editing.saving ? 'Saving…' : 'Save'}
              </Button>
            </>
          }
        >
          {presence[editing.id]?.length ? (
            <div className="cb-notice cb-notice--warn">
              Also editing right now: {presence[editing.id].join(', ')}
            </div>
          ) : null}

          {editing.error && (
            <div className="cb-notice cb-notice--warn">
              <div>{editing.error}</div>
              {editing.conflict && (
                <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                  <Button
                    size="sm"
                    onClick={() =>
                      setEditing((prev) =>
                        prev
                          ? {
                              ...prev,
                              name: prev.conflictName ?? prev.name,
                              content: prev.conflictContent ?? prev.content,
                              version: prev.conflictVersion ?? prev.version,
                              conflict: false,
                              error: null,
                            }
                          : prev
                      )
                    }
                  >
                    Reload theirs
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    onClick={() => void saveEdit(editing.conflictVersion)}
                  >
                    Overwrite with mine
                  </Button>
                </div>
              )}
            </div>
          )}

          <label className="cb-field">
            <span className="cb-label">name</span>
            <input
              className="cb-input"
              value={editing.name}
              onChange={(e) => setEditing((p) => (p ? { ...p, name: e.target.value } : p))}
            />
          </label>

          <label className="cb-field">
            <span className="cb-label">content</span>
            <textarea
              className="cb-textarea"
              value={editing.content}
              onChange={(e) => setEditing((p) => (p ? { ...p, content: e.target.value } : p))}
            />
          </label>
        </Modal>
      )}

      {sharing && (
        <Modal
          title="share paste"
          onClose={() => setSharing(null)}
          footer={<Button onClick={() => setSharing(null)}>Done</Button>}
        >
          <p className="cb-section-sub">
            Collaborators can view and edit this paste from their dashboard.
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              className="cb-input"
              list="cleanbin-users-list"
              placeholder="teammate@example.com"
              value={sharing.email}
              onChange={(e) => setSharing((p) => (p ? { ...p, email: e.target.value } : p))}
            />
            <datalist id="cleanbin-users-list">
              {users.map((u) => (
                <option key={u.email} value={u.email} />
              ))}
            </datalist>
            <Button
              variant="primary"
              disabled={sharing.busy || !sharing.email.trim()}
              onClick={() => void changeShare(sharing.email.trim(), 'add')}
            >
              Add
            </Button>
          </div>

          {sharing.list.length === 0 ? (
            <div className="cb-section-sub">Not shared with anyone yet.</div>
          ) : (
            <div>
              {sharing.list.map((addr) => (
                <div className="cb-kv-row" key={addr}>
                  <span>{addr}</span>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={sharing.busy}
                    onClick={() => void changeShare(addr, 'remove')}
                  >
                    remove
                  </Button>
                </div>
              ))}
            </div>
          )}
        </Modal>
      )}

      {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
    </>
  );
}
