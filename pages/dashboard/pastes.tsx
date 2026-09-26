import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { FiClipboard, FiCopy, FiEdit2, FiEye, FiFilter, FiTrash2 } from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import BulkDeleteModal, { type BulkDeleteRequest } from '../../components/dashboard/BulkDeleteModal';
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
} from '../../components/dashboard/ui';
import type { DashboardSession, Paste, TableColumn } from '../../components/dashboard/types';
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

const DEFAULT_ADVANCED_FILTERS: AdvancedFilterRule[] = [{ field: 'any', op: 'contains', value: '', permanent: 'any' }];

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
    const { items, total, page, totalPages, loading, error, setPage, refresh, removeIds, updateName } = usePastes(50);

    const [searchTerm, setSearchTerm] = useState('');
    const [sortOrder, setSortOrder] = useState<SortOrder>(null);
    const [sortReverse, setSortReverse] = useState(false);
    const [showAdvancedFilter, setShowAdvancedFilter] = useState(false);
    const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterRule[]>(DEFAULT_ADVANCED_FILTERS);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [deleteRequest, setDeleteRequest] = useState<BulkDeleteRequest | null>(null);
    const [renameTarget, setRenameTarget] = useState<Paste | null>(null);
    const [renameValue, setRenameValue] = useState('');

    const filteredPastes = useMemo(() => {
        const query = searchTerm.trim().toLowerCase();
        const filtered = query
            ? items.filter(
                  (paste) =>
                      paste.name?.toLowerCase().includes(query) ||
                      paste.content?.toLowerCase().includes(query) ||
                      paste.id?.toLowerCase().includes(query)
              )
            : items;
        return sortPastes(filtered, sortOrder, sortReverse);
    }, [items, searchTerm, sortOrder, sortReverse]);

    const allSelected = filteredPastes.length > 0 && filteredPastes.every((paste) => selectedIds.has(paste.id));

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

    const handleDeletePaste = async (paste: Paste) => {
        if (!window.confirm(`Delete "${paste.name || 'this paste'}"? This cannot be undone.`)) return;
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

    const openRename = (paste: Paste) => {
        setRenameTarget(paste);
        setRenameValue(paste.name || '');
    };

    const handleSaveRename = async () => {
        if (!renameTarget) return;
        const response = await fetch(`/api/paste/${renameTarget.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: renameValue }),
        });
        if (response.ok) {
            updateName(renameTarget.id, renameValue);
            addNotification('Name updated.');
            void postBroadcast({ type: 'paste_renamed', id: renameTarget.id, name: renameValue });
            setRenameTarget(null);
        } else {
            addNotification('Failed to update the name.');
        }
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
            render: (row) => <span className="dash-cell-truncate">{row.name || 'Untitled'}</span>,
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
                    <IconButton label="Rename" onClick={() => openRename(row)}>
                        <FiEdit2 />
                    </IconButton>
                    <IconButton label="Delete" tone="danger" onClick={() => void handleDeletePaste(row)}>
                        <FiTrash2 />
                    </IconButton>
                </span>
            ),
        },
    ];

    const hasFilters = searchTerm.trim().length > 0 || sortOrder !== null;

    return (
        <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
            <PageHeader
                title="Pastes"
                description={`${total} paste${total === 1 ? '' : 's'} stored${sessionRole === 'admin' ? '' : ` · up to ${permanentDeleteLimit ?? 0} permanent deletes per operation`}.`}
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
                        placeholder="Search name, content or UUID..."
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                        aria-label="Search pastes"
                    />
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
                                        : 'Create your first paste from the editor and it will show up here.'
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

            {renameTarget && (
                <Modal
                    title="Rename paste"
                    onClose={() => setRenameTarget(null)}
                    footer={
                        <>
                            <Button variant="ghost" onClick={() => setRenameTarget(null)}>
                                Cancel
                            </Button>
                            <Button variant="primary" onClick={() => void handleSaveRename()}>
                                Save
                            </Button>
                        </>
                    }
                >
                    <p className="dash-modal-desc">
                        Use <code>&lt;br&gt;</code> for line breaks and <code>&lt;hr&gt;</code> for a horizontal line.
                    </p>
                    <Input
                        autoFocus
                        value={renameValue}
                        onChange={(event) => setRenameValue(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key === 'Enter') void handleSaveRename();
                            if (event.key === 'Escape') setRenameTarget(null);
                        }}
                        aria-label="New paste name"
                    />
                </Modal>
            )}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
