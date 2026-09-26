import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import {
    FiClipboard,
    FiCopy,
    FiEdit2,
    FiEye,
    FiFilter,
    FiSave,
    FiSearch,
    FiShare2,
    FiTrash2,
    FiUsers,
    FiX,
} from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import BulkDeleteModal, { type BulkDeleteMode } from '../../components/dashboard/BulkDeleteModal';
import ConfirmModal, { type ConfirmRequest } from '../../components/dashboard/ConfirmModal';
import FiltersPanel from '../../components/dashboard/FiltersPanel';
import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    IconButton,
    Input,
    LoadingState,
    Modal,
    PageHeader,
    Select,
    Table,
    Textarea,
} from '../../components/dashboard/ui';
import type {
    DashboardSession,
    DashboardUser,
    Paste,
    PasteFilterRule,
    PasteListQuery,
    PasteMatchMode,
    PasteScope,
    PasteSortDir,
    PasteSortField,
    TableColumn,
} from '../../components/dashboard/types';
import { usePastes } from '../../components/dashboard/usePastes';
import { formatDateTime } from '../../components/dashboard/format';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
import { useNotification } from '../../components/NotificationProvider';

// Encoded sort options for the single order select. Encodes both the field and
// the direction so there is no separate, ambiguous "Normal/Reverse" control.
type SortValue = 'default' | 'createdAt:desc' | 'createdAt:asc' | 'name:asc' | 'name:desc';

const SORT_OPTIONS: Array<{ value: SortValue; label: string }> = [
    { value: 'default', label: 'Newest first' },
    { value: 'createdAt:asc', label: 'Oldest first' },
    { value: 'name:asc', label: 'Name A→Z' },
    { value: 'name:desc', label: 'Name Z→A' },
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

const DEFAULT_FILTER_RULES: PasteFilterRule[] = [];
const PRESENCE_POLL_MS = 5000;
const SEARCH_DEBOUNCE_MS = 300;

function isPermanent(paste: Paste): boolean {
    return String(paste.permanent) === 'true' || paste.permanent === true;
}

// Splits the encoded sort option into the API `sort`/`dir` pair.
function decodeSort(value: SortValue): { sort: PasteSortField | null; dir: PasteSortDir } {
    if (value === 'default') return { sort: null, dir: 'desc' };
    const [field, dir] = value.split(':');
    return { sort: field as PasteSortField, dir: dir as PasteSortDir };
}

function describeRule(rule: PasteFilterRule): string {
    const field = rule.field === 'any' ? 'any field' : rule.field === 'id' ? 'UUID' : rule.field;
    return `${rule.negate ? 'not ' : ''}${field} ${rule.op} “${rule.value}”`;
}

export default function PastesPage({ sessionEmail, sessionRole, permanentDeleteLimit }: DashboardSession) {
    const router = useRouter();
    const { addNotification } = useNotification();
    const isAdmin = sessionRole === 'admin';

    const [scope, setScope] = useState<PasteScope>(isAdmin ? 'all' : 'default');
    const [searchInput, setSearchInput] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [sortValue, setSortValue] = useState<SortValue>('default');
    const [showFilters, setShowFilters] = useState(false);
    const [draftRules, setDraftRules] = useState<PasteFilterRule[]>(DEFAULT_FILTER_RULES);
    const [activeRules, setActiveRules] = useState<PasteFilterRule[]>(DEFAULT_FILTER_RULES);
    const [matchMode, setMatchMode] = useState<PasteMatchMode>('AND');

    // One request per pause in typing, not one per keystroke.
    useEffect(() => {
        const timer = window.setTimeout(() => setDebouncedQuery(searchInput.trim()), SEARCH_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [searchInput]);

    const listQuery = useMemo<PasteListQuery>(() => {
        const { sort, dir } = decodeSort(sortValue);
        return { scope, query: debouncedQuery, filterRules: activeRules, matchMode, sort, dir };
    }, [scope, debouncedQuery, activeRules, matchMode, sortValue]);

    const { items, total, page, totalPages, loading, error, setPage, refresh, removeIds, updatePaste } = usePastes(50, listQuery);

    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteMode, setDeleteMode] = useState<BulkDeleteMode | null>(null);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

    const [editing, setEditing] = useState<EditState | null>(null);
    const [sharing, setSharing] = useState<ShareState | null>(null);
    const [users, setUsers] = useState<DashboardUser[]>([]);
    const [presence, setPresence] = useState<Record<string, string[]>>({});

    const allSelected = items.length > 0 && items.every((paste) => selectedIds.has(paste.id));

    // A selection only ever refers to the rows on screen: changing the page,
    // the scope or any filter clears it so we never delete what we cannot see.
    const selectionKey = `${page}|${JSON.stringify(listQuery)}`;
    useEffect(() => {
        setSelectedIds(new Set());
    }, [selectionKey]);

    // User directory (admin only) powers the Share modal's email suggestions.
    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        fetch('/api/users')
            .then((response) => (response.ok ? response.json() : []))
            .then((list) => {
                if (active) setUsers(Array.isArray(list) ? list : []);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [isAdmin]);

    // Real-time refresh: BroadcastChannel when available, light polling as a fallback.
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        let interval: number | undefined;
        let active = true;

        const startFallback = () => {
            interval = window.setInterval(() => {
                if (document.visibilityState !== 'hidden') refresh();
            }, 30000);
        };

        import('../../utils/broadcast')
            .then((mod) => {
                if (!active) return;
                const channel = mod.getBroadcastChannel();
                if (channel) {
                    cleanup = mod.listen((message: { type?: string }) => {
                        if (message && message.type?.startsWith('paste')) refresh();
                    });
                    return;
                }
                startFallback();
            })
            .catch(() => {
                if (active) startFallback();
            });

        return () => {
            active = false;
            if (cleanup) cleanup();
            if (interval) clearInterval(interval);
        };
    }, [refresh]);

    // Batch presence read: one request every few seconds for the rows on screen.
    const pageIds = useMemo(() => items.map((paste) => paste.id), [items]);
    useEffect(() => {
        if (pageIds.length === 0) {
            setPresence({});
            return;
        }
        let active = true;

        const poll = async () => {
            if (document.visibilityState === 'hidden') return;
            try {
                const response = await fetch(`/api/pastes/presence?ids=${encodeURIComponent(pageIds.join(','))}`);
                if (!response.ok) return;
                const body = await response.json();
                if (active && body && typeof body.editors === 'object') setPresence(body.editors);
            } catch {
                // Presence is best-effort.
            }
        };

        void poll();
        const interval = window.setInterval(poll, PRESENCE_POLL_MS);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [pageIds]);

    // While the edit modal is open, beat for that paste so other editors see us.
    const editingId = editing?.id ?? null;
    useEffect(() => {
        if (!editingId) return;
        let active = true;

        const beat = async () => {
            try {
                const response = await fetch(`/api/paste/${editingId}/presence`, { method: 'POST' });
                if (!response.ok) return;
                const body = await response.json();
                if (active && Array.isArray(body.editors)) {
                    setPresence((prev) => ({ ...prev, [editingId]: body.editors }));
                }
            } catch {
                // Presence is best-effort.
            }
        };

        void beat();
        const interval = window.setInterval(beat, PRESENCE_POLL_MS);
        return () => {
            active = false;
            clearInterval(interval);
        };
    }, [editingId]);

    const postBroadcast = useCallback(async (message: Record<string, unknown>) => {
        try {
            const { postMessage } = await import('../../utils/broadcast');
            postMessage(message as never);
        } catch {
            // Broadcast is best-effort.
        }
    }, []);

    const copyToClipboard = useCallback(
        (value: string, successMessage: string) => {
            if (navigator.clipboard) {
                navigator.clipboard.writeText(value).then(
                    () => addNotification(successMessage),
                    () => addNotification('Could not copy to clipboard')
                );
                return;
            }
            addNotification('Could not copy to clipboard');
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

    const toggleSelectAll = (checked: boolean) => {
        setSelectedIds(checked ? new Set(items.map((paste) => paste.id)) : new Set());
    };

    const handleDeleted = (ids: string[]) => {
        removeIds(ids);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
        // Refresh so the counters and pagination reflect the server's new state.
        refresh();
        addNotification(`Deleted ${ids.length} paste${ids.length === 1 ? '' : 's'}.`);
        void postBroadcast({ type: 'pastes_bulk_deleted', ids });
    };

    const clearFilters = useCallback(() => {
        setSearchInput('');
        setDebouncedQuery('');
        setSortValue('default');
        setDraftRules(DEFAULT_FILTER_RULES);
        setActiveRules(DEFAULT_FILTER_RULES);
        setMatchMode('AND');
    }, []);

    const openDelete = () => {
        const defaultMode: BulkDeleteMode =
            selectedIds.size > 0 ? 'selected' : debouncedQuery || activeRules.length > 0 ? 'filtered' : 'all';
        setDeleteMode(defaultMode);
    };

    const performDeletePaste = async (paste: Paste) => {
        const response = await fetch(`/api/paste/${paste.id}`, { method: 'DELETE' });
        if (response.ok) {
            removeIds([paste.id]);
            setSelectedIds((prev) => {
                const next = new Set(prev);
                next.delete(paste.id);
                return next;
            });
            addNotification('Paste deleted.');
            void postBroadcast({ type: 'paste_deleted', id: paste.id });
        } else {
            addNotification('Failed to delete paste.');
        }
    };

    const handleDeletePaste = (paste: Paste) => {
        setConfirm({
            title: 'Delete paste',
            description: `Delete "${paste.name || 'this paste'}"? This cannot be undone.`,
            confirmLabel: 'Delete paste',
            tone: 'danger',
            onConfirm: () => {
                setConfirm(null);
                void performDeletePaste(paste);
            },
        });
    };

    const openEdit = (paste: Paste) => {
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
        // Refresh the authoritative content + version in the background.
        fetch(`/api/paste/${paste.id}`)
            .then((response) => (response.ok ? response.json() : null))
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
                          error: body?.error || 'Someone else changed this paste.',
                          // Keep the server state so "Reload" and "Overwrite" work.
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
            setEditing((prev) => (prev ? { ...prev, saving: false, error: body?.message || 'Failed to save the paste.' } : prev));
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
        } else {
            updatePaste(editing.id, { name: editing.name, content: editing.content });
        }
        addNotification('Paste saved.');
        void postBroadcast({ type: 'paste_updated', id: editing.id });
        setEditing(null);
    };

    const openShare = (paste: Paste) => {
        setSharing({ id: paste.id, list: paste.sharedWith ?? [], email: '', busy: false });
    };

    const changeShare = async (email: string, action: 'add' | 'remove') => {
        if (!sharing) return;
        setSharing((prev) => (prev ? { ...prev, busy: true } : prev));
        const response = await fetch(`/api/paste/${sharing.id}/share`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, action }),
        });
        const body = await response.json().catch(() => ({}));
        if (response.ok && Array.isArray(body.sharedWith)) {
            setSharing((prev) => (prev ? { ...prev, list: body.sharedWith, email: '', busy: false } : prev));
            updatePaste(sharing.id, { sharedWith: body.sharedWith });
            addNotification(action === 'add' ? 'Access granted.' : 'Access removed.');
        } else {
            setSharing((prev) => (prev ? { ...prev, busy: false } : prev));
            addNotification(body.message || 'Failed to update access.');
        }
    };

    const addShare = () => {
        if (!sharing) return;
        const email = sharing.email.trim();
        if (!email) return;
        void changeShare(email, 'add');
    };

    const columns: TableColumn<Paste>[] = [
        {
            key: 'select',
            header: (
                <input
                    type="checkbox"
                    className="dash-checkbox"
                    checked={allSelected}
                    onChange={(event) => toggleSelectAll(event.target.checked)}
                    aria-label="Select all pastes on this page"
                />
            ),
            width: '40px',
            render: (row) => (
                <input
                    type="checkbox"
                    className="dash-checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleSelect(row.id)}
                    aria-label={`Select ${row.name || row.id}`}
                />
            ),
        },
        {
            key: 'name',
            header: 'Name',
            render: (row) => (
                <span className="dash-row" style={{ gap: 6, alignItems: 'center' }}>
                    {presence[row.id]?.length ? (
                        <span
                            className="dash-presence-dot"
                            title={`Editing now: ${presence[row.id].join(', ')}`}
                            aria-label={`Editing now: ${presence[row.id].join(', ')}`}
                        />
                    ) : null}
                    <span className="dash-cell-truncate">{row.name || 'Untitled'}</span>
                </span>
            ),
        },
        {
            key: 'owner',
            header: 'Owner',
            render: (row) =>
                row.mine ? (
                    <Badge tone="accent">You</Badge>
                ) : row.owner ? (
                    <span className="dash-cell-truncate" title={row.owner}>
                        {row.owner}
                    </span>
                ) : (
                    <Badge>anonymous</Badge>
                ),
        },
        {
            key: 'id',
            header: 'UUID',
            render: (row) => (
                <button type="button" className="dash-mono-id" title="Copy UUID" onClick={() => copyToClipboard(row.id, 'UUID copied')}>
                    {row.id}
                </button>
            ),
        },
        {
            key: 'permanent',
            header: 'Type',
            render: (row) => (isPermanent(row) ? <Badge tone="permanent">permanent</Badge> : <Badge>temporary</Badge>),
        },
        { key: 'createdAt', header: 'Created', render: (row) => <span className="dash-muted">{formatDateTime(row.createdAt)}</span> },
        {
            key: 'actions',
            header: '',
            align: 'right',
            render: (row) => (
                <span className="dash-cell-actions">
                    <IconButton label="Preview" onClick={() => window.open(`/${row.id}`, '_blank')}>
                        <FiEye />
                    </IconButton>
                    <IconButton label="Copy URL" onClick={() => copyToClipboard(`${window.location.origin}/${row.id}`, 'URL copied')}>
                        <FiClipboard />
                    </IconButton>
                    <IconButton label="Clone" onClick={() => router.push(`/clone/${row.id}`)}>
                        <FiCopy />
                    </IconButton>
                    <IconButton label="Share" onClick={() => openShare(row)}>
                        <FiShare2 />
                    </IconButton>
                    <IconButton label="Edit" onClick={() => openEdit(row)}>
                        <FiEdit2 />
                    </IconButton>
                    <IconButton label="Delete" tone="danger" onClick={() => void handleDeletePaste(row)}>
                        <FiTrash2 />
                    </IconButton>
                </span>
            ),
        },
    ];

    const scopeOptions: Array<{ value: PasteScope; label: string }> = isAdmin
        ? [
              { value: 'all', label: 'All pastes' },
              { value: 'mine', label: 'Mine' },
              { value: 'shared', label: 'Shared with me' },
              { value: 'anonymous', label: 'Anonymous' },
          ]
        : [
              { value: 'default', label: 'Mine & shared' },
              { value: 'mine', label: 'Only mine' },
              { value: 'shared', label: 'Shared with me' },
          ];

    const hasActiveFilters = debouncedQuery.length > 0 || activeRules.length > 0 || sortValue !== 'default';

    // One removable chip per active filter. The scope stays in its labelled
    // select; everything that narrows or reorders the list shows up here.
    const filterChips: Array<{ key: string; label: string; onRemove: () => void }> = [];
    if (debouncedQuery) {
        filterChips.push({ key: 'query', label: `search: ${debouncedQuery}`, onRemove: () => setSearchInput('') });
    }
    activeRules.forEach((rule, index) => {
        filterChips.push({
            key: `rule-${index}`,
            label: describeRule(rule),
            onRemove: () => setActiveRules((prev) => prev.filter((_, i) => i !== index)),
        });
    });
    if (sortValue !== 'default') {
        const label = SORT_OPTIONS.find((option) => option.value === sortValue)?.label ?? sortValue;
        filterChips.push({ key: 'sort', label: label.replace(/^Sort:\s*/, 'sort: '), onRemove: () => setSortValue('default') });
    }

    return (
        <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
            <PageHeader
                title="Pastes"
                description={`${total} paste${total === 1 ? '' : 's'} stored${isAdmin ? ' · you see every user’s pastes' : ' · your pastes and the ones shared with you'}.`}
                actions={
                    <Button variant="primary" onClick={() => router.push('/')}>
                        New paste
                    </Button>
                }
            />

            <Card animationDelay={0}>
                <div className="dash-toolbar">
                    <div className="dash-search-wrap">
                        <FiSearch className="dash-search-icon" aria-hidden="true" />
                        <Input
                            className="dash-search"
                            type="search"
                            placeholder="Search name, content, owner or UUID…"
                            value={searchInput}
                            onChange={(event) => setSearchInput(event.target.value)}
                            aria-label="Search pastes"
                        />
                    </div>
                    <Select
                        value={scope}
                        onChange={(event) => setScope(event.target.value as PasteScope)}
                        aria-label="Filter by ownership"
                    >
                        {scopeOptions.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                    <Select value={sortValue} onChange={(event) => setSortValue(event.target.value as SortValue)} aria-label="Sort pastes">
                        {SORT_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </Select>
                    <Button
                        variant={showFilters || activeRules.length > 0 ? 'secondary' : 'ghost'}
                        icon={<FiFilter />}
                        aria-expanded={showFilters}
                        onClick={() => {
                            setDraftRules(activeRules);
                            setShowFilters((prev) => !prev);
                        }}
                    >
                        Filters{activeRules.length > 0 ? ` (${activeRules.length})` : ''}
                    </Button>
                    <div className="dash-toolbar-end">
                        {selectedIds.size > 0 ? (
                            <span className="dash-selection" aria-live="polite">
                                <span className="dash-selection-count">{selectedIds.size} selected</span>
                                <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                                    Clear
                                </Button>
                            </span>
                        ) : (
                            <span className="dash-results" aria-live="polite">
                                {total} paste{total === 1 ? '' : 's'}
                                {total > 0 ? ` · page ${page} of ${totalPages}` : ''}
                            </span>
                        )}
                        <Button variant="danger-ghost" icon={<FiTrash2 />} onClick={openDelete} disabled={total === 0}>
                            Delete…
                        </Button>
                    </div>
                </div>

                {filterChips.length > 0 && (
                    <div className="dash-chips">
                        {filterChips.map((chip) => (
                            <span className="dash-chip" key={chip.key}>
                                {chip.label}
                                <button type="button" className="dash-chip-x" aria-label={`Remove filter ${chip.label}`} onClick={chip.onRemove}>
                                    <FiX size={12} />
                                </button>
                            </span>
                        ))}
                        <button type="button" className="dash-chip-clear" onClick={clearFilters}>
                            Clear all
                        </button>
                    </div>
                )}

                {showFilters && (
                    <div style={{ marginBottom: 'var(--dash-space-4)' }}>
                        <FiltersPanel
                            rules={draftRules}
                            matchMode={matchMode}
                            onRulesChange={setDraftRules}
                            onMatchModeChange={setMatchMode}
                            onApply={() => {
                                setActiveRules(draftRules.filter((rule) => rule.value.trim().length > 0));
                                setShowFilters(false);
                            }}
                            onClear={() => {
                                setDraftRules(DEFAULT_FILTER_RULES);
                                setActiveRules(DEFAULT_FILTER_RULES);
                            }}
                        />
                    </div>
                )}

                {error && <Callout tone="danger">{error}</Callout>}

                {loading ? (
                    <LoadingState label="Loading pastes..." />
                ) : (
                    <Table
                        columns={columns}
                        rows={items}
                        rowKey={(row) => row.id}
                        empty={
                            <EmptyState
                                icon={<FiFilter size={26} />}
                                title={hasActiveFilters ? 'No matches' : 'No pastes yet'}
                                description={
                                    hasActiveFilters
                                        ? 'No paste matches the current search or filters.'
                                        : isAdmin
                                          ? 'Pastes created by any user will show up here.'
                                          : 'Create your first paste or ask a teammate to share one with you.'
                                }
                                action={
                                    hasActiveFilters ? (
                                        <Button variant="ghost" onClick={clearFilters}>
                                            Clear filters
                                        </Button>
                                    ) : (
                                        <Button variant="primary" onClick={() => router.push('/')}>
                                            New paste
                                        </Button>
                                    )
                                }
                            />
                        }
                    />
                )}

                <div className="dash-pagination">
                    <span>
                        Page {page} of {totalPages}
                    </span>
                    <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                        Prev
                    </Button>
                    <Button size="sm" variant="ghost" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
                        Next
                    </Button>
                </div>
            </Card>

            {deleteMode && (
                <BulkDeleteModal
                    defaultMode={deleteMode}
                    selectedIds={Array.from(selectedIds)}
                    selectedRows={items.filter((paste) => selectedIds.has(paste.id))}
                    scope={scope}
                    query={debouncedQuery}
                    filterRules={activeRules}
                    matchMode={matchMode}
                    onClose={() => setDeleteMode(null)}
                    onDeleted={handleDeleted}
                />
            )}

            {editing && (
                <Modal
                    title={`Edit ${editing.name || 'paste'}`}
                    wide
                    onClose={() => setEditing(null)}
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setEditing(null)}>
                                Cancel
                            </Button>
                            <Button variant="primary" icon={<FiSave />} disabled={editing.saving} onClick={() => void saveEdit()}>
                                {editing.saving ? 'Saving...' : 'Save'}
                            </Button>
                        </>
                    }
                >
                    {presence[editing.id]?.length ? (
                        <Callout tone="warning">
                            Also editing: {presence[editing.id].join(', ')}
                        </Callout>
                    ) : null}
                    {editing.error && (
                        <Callout tone="warning">
                            <div>{editing.error}</div>
                            {editing.conflict && (
                                <div className="dash-row" style={{ marginTop: 'var(--dash-space-2)' }}>
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
                                        Reload latest
                                    </Button>
                                    <Button
                                        size="sm"
                                        variant="danger"
                                        onClick={() => void saveEdit(editing.conflictVersion)}
                                    >
                                        Overwrite anyway
                                    </Button>
                                </div>
                            )}
                        </Callout>
                    )}
                    <div className="dash-stack">
                        <Input
                            label="Name"
                            autoFocus
                            value={editing.name}
                            onChange={(event) => setEditing((prev) => (prev ? { ...prev, name: event.target.value } : prev))}
                            aria-label="Paste name"
                        />
                        <Textarea
                            label="Content"
                            value={editing.content}
                            onChange={(event) => setEditing((prev) => (prev ? { ...prev, content: event.target.value } : prev))}
                            spellCheck={false}
                            aria-label="Paste content"
                        />
                    </div>
                    <p className="dash-note" style={{ marginTop: 'var(--dash-space-2)' }}>
                        Version {editing.version} · last saved {formatDateTime(editing.updatedAt)}
                    </p>
                </Modal>
            )}

            {sharing && (
                <Modal
                    title={`Share ${items.find((paste) => paste.id === sharing.id)?.name || 'paste'}`}
                    onClose={() => setSharing(null)}
                    footer={
                        <Button variant="ghost" onClick={() => setSharing(null)}>
                            Done
                        </Button>
                    }
                >
                    <p className="dash-modal-desc">People with access can edit this paste. Only the owner or an admin can change this list.</p>
                    {sharing.list.length === 0 ? (
                        <p className="dash-faint">Not shared with anyone yet.</p>
                    ) : (
                        <div className="dash-stack" style={{ marginBottom: 'var(--dash-space-4)' }}>
                            {sharing.list.map((email) => (
                                <div key={email} className="dash-row" style={{ justifyContent: 'space-between' }}>
                                    <span className="dash-cell-truncate">{email}</span>
                                    <Button size="sm" variant="ghost" disabled={sharing.busy} onClick={() => void changeShare(email, 'remove')}>
                                        Remove
                                    </Button>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="dash-row">
                        <Input
                            className="dash-grow"
                            type="email"
                            list={isAdmin ? 'share-email-options' : undefined}
                            placeholder="name@example.com"
                            value={sharing.email}
                            onChange={(event) => setSharing((prev) => (prev ? { ...prev, email: event.target.value } : prev))}
                            onKeyDown={(event) => {
                                if (event.key === 'Enter') addShare();
                            }}
                            aria-label="Email to share with"
                        />
                        <Button variant="primary" icon={<FiUsers />} disabled={sharing.busy || !sharing.email.trim()} onClick={addShare}>
                            Add
                        </Button>
                    </div>
                    {isAdmin && (
                        <datalist id="share-email-options">
                            {users.map((user) => (
                                <option key={user.email} value={user.email} />
                            ))}
                        </datalist>
                    )}
                </Modal>
            )}

            {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
