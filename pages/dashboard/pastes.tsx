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
    FiShare2,
    FiTrash2,
    FiUsers,
} from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import BulkDeleteModal, { type BulkDeleteRequest } from '../../components/dashboard/BulkDeleteModal';
import ConfirmModal, { type ConfirmRequest } from '../../components/dashboard/ConfirmModal';
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
import type { DashboardSession, DashboardUser, Paste, PasteScope, TableColumn } from '../../components/dashboard/types';
import { usePastes } from '../../components/dashboard/usePastes';
import { formatDateTime } from '../../components/dashboard/format';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
import { useNotification } from '../../components/NotificationProvider';
import AdvancedFilters from '../../components/AdvancedFilters';

type SortOrder = 'name' | 'date' | 'permanent' | null;

type AdvancedFilterRule = {
    field: 'any' | 'name' | 'content' | 'id';
    op: 'contains' | 'exact' | 'starts' | 'regex';
    value: string;
    permanent?: 'yes' | 'no' | 'any';
};

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

const DEFAULT_ADVANCED_FILTERS: AdvancedFilterRule[] = [{ field: 'any', op: 'contains', value: '', permanent: 'any' }];
const PRESENCE_POLL_MS = 5000;

function isPermanent(paste: Paste): boolean {
    return String(paste.permanent) === 'true' || paste.permanent === true;
}

function sortPastes(pastes: Paste[], order: SortOrder, reverse: boolean): Paste[] {
    if (!order) return pastes;
    const sorted = [...pastes].sort((a, b) => {
        if (order === 'name') return (a.name || '').localeCompare(b.name || '');
        if (order === 'date') return new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime();
        return (isPermanent(a) ? 1 : 0) - (isPermanent(b) ? 1 : 0);
    });
    return reverse ? sorted.reverse() : sorted;
}

export default function PastesPage({ sessionEmail, sessionRole, permanentDeleteLimit }: DashboardSession) {
    const router = useRouter();
    const { addNotification } = useNotification();
    const isAdmin = sessionRole === 'admin';

    const [scope, setScope] = useState<PasteScope>(isAdmin ? 'all' : 'default');
    const { items, total, page, totalPages, loading, error, setPage, refresh, removeIds, updatePaste } = usePastes(50, scope);

    const [searchTerm, setSearchTerm] = useState('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(null);
    const [sortReverse, setSortReverse] = useState(false);
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterRule[]>(DEFAULT_ADVANCED_FILTERS);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteRequest, setDeleteRequest] = useState<BulkDeleteRequest | null>(null);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

    const [editing, setEditing] = useState<EditState | null>(null);
    const [sharing, setSharing] = useState<ShareState | null>(null);
    const [users, setUsers] = useState<DashboardUser[]>([]);
    const [presence, setPresence] = useState<Record<string, string[]>>({});

    const filteredPastes = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        const filtered = query
            ? items.filter(
                  (paste) =>
                      paste.name?.toLowerCase().includes(query) ||
                      paste.content?.toLowerCase().includes(query) ||
                      paste.id?.toLowerCase().includes(query) ||
                      paste.owner?.toLowerCase().includes(query)
              )
            : items;
        return sortPastes(filtered, sortOrder, sortReverse);
    }, [items, searchTerm, sortOrder, sortReverse]);

    const allSelected = filteredPastes.length > 0 && filteredPastes.every((paste) => selectedIds.has(paste.id));

    // Clear the selection whenever the visible set (scope) changes.
    useEffect(() => {
        setSelectedIds(new Set());
    }, [scope]);

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
        setSelectedIds(checked ? new Set(filteredPastes.map((paste) => paste.id)) : new Set());
    };

    const handleAddToSelection = (ids: string[]) => {
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
        });
    };

    const handleDeleted = (ids: string[]) => {
        removeIds(ids);
        setSelectedIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.delete(id));
            return next;
        });
        if (ids.length === 0 && !searchTerm) refresh();
        addNotification(`Deleted ${ids.length} paste${ids.length === 1 ? '' : 's'}.`);
        void postBroadcast({ type: 'pastes_bulk_deleted', ids });
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

    const hasFilters = searchTerm.trim().length > 0 || sortOrder !== null;

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
                    <Input
                        className="dash-search"
                        type="search"
                        placeholder="Search name, content, owner or UUID..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        aria-label="Search pastes"
                    />
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
                    <Select
                        value={sortOrder ?? 'default'}
                        onChange={(event) => {
                            const value = event.target.value;
                            setSortOrder(value === 'default' ? null : (value as SortOrder));
                        }}
                        aria-label="Sort pastes"
                    >
                        <option value="default">Sort: default</option>
                        <option value="name">Sort by name</option>
                        <option value="date">Sort by date</option>
                        <option value="permanent">Sort by type</option>
                    </Select>
                    <Button variant="ghost" onClick={() => setSortReverse((prev) => !prev)} disabled={!sortOrder}>
                        {sortReverse ? 'Reverse' : 'Normal'}
                    </Button>
                    <Button variant="ghost" icon={<FiFilter />} onClick={() => setShowAdvancedFilter((prev) => !prev)}>
                        {showAdvancedFilter ? 'Hide filters' : 'Filters'}
                    </Button>
                    {hasFilters && (
                        <Button
                            variant="ghost"
                            onClick={() => {
                                setSearchTerm('');
                                setSortOrder(null);
                                setSortReverse(false);
                                setAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
                            }}
                        >
                            Clear
                        </Button>
                    )}
                    <span className="dash-toolbar-spacer" />
                    <span className="dash-muted">
                        {selectedIds.size} selected
                    </span>
                </div>

                {showAdvancedFilter && (
                    <div style={{ marginBottom: 'var(--dash-space-4)' }}>
                        <AdvancedFilters
                            advancedFilters={advancedFilters as never}
                            setAdvancedFilters={setAdvancedFilters as never}
                            setSearchTerm={setSearchTerm}
                            setShowAdvancedFilter={setShowAdvancedFilter}
                        />
                    </div>
                )}

                <div className="dash-row" role="toolbar" aria-label="Delete options" style={{ marginBottom: 'var(--dash-space-4)' }}>
                    <Button variant="danger" size="sm" onClick={() => setDeleteRequest({ mode: 'all' })}>
                        All
                    </Button>
                    <Button variant="warning" size="sm" onClick={() => setDeleteRequest({ mode: 'permanent' })}>
                        Permanent
                    </Button>
                    <Button variant="primary" size="sm" onClick={() => setDeleteRequest({ mode: 'temporary' })}>
                        Temporary
                    </Button>
                    <Button size="sm" onClick={() => setDeleteRequest({ mode: 'filtered', filter: searchTerm })}>
                        Filtered
                    </Button>
                    <Button variant="permanent" size="sm" disabled={selectedIds.size === 0} onClick={() => setDeleteRequest({ mode: 'selected' })}>
                        Selected ({selectedIds.size})
                    </Button>
                    <span className="dash-faint">Bulk deletes are irreversible.</span>
                </div>

                {error && <Callout tone="danger">{error}</Callout>}

                {loading ? (
                    <LoadingState label="Loading pastes..." />
                ) : (
                    <Table
                        columns={columns}
                        rows={filteredPastes}
                        rowKey={(row) => row.id}
                        empty={
                            <EmptyState
                                icon={<FiFilter size={26} />}
                                title={hasFilters ? 'No matches' : 'No pastes yet'}
                                description={
                                    hasFilters
                                        ? 'No paste matches the current search or filters.'
                                        : isAdmin
                                          ? 'Pastes created by any user will show up here.'
                                          : 'Create your first paste or ask a teammate to share one with you.'
                                }
                                action={
                                    hasFilters ? (
                                        <Button
                                            variant="ghost"
                                            onClick={() => {
                                                setSearchTerm('');
                                                setAdvancedFilters(DEFAULT_ADVANCED_FILTERS);
                                            }}
                                        >
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

            {deleteRequest && (
                <BulkDeleteModal
                    request={deleteRequest}
                    selectedIds={Array.from(selectedIds)}
                    onClose={() => setDeleteRequest(null)}
                    onDeleted={handleDeleted}
                    onAddToSelection={handleAddToSelection}
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
