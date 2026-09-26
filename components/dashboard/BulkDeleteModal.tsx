import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Paste, PasteFilterRule, PasteMatchMode, PasteScope, TableColumn } from './types';
import { Badge, Button, Callout, Input, Table } from './ui';

export type BulkDeleteMode = 'all' | 'permanent' | 'temporary' | 'filtered' | 'selected';

type BulkDeleteModalProps = {
    defaultMode: BulkDeleteMode;
    selectedIds: string[];
    selectedRows: Paste[];
    scope: PasteScope;
    query: string;
    filterRules: PasteFilterRule[];
    matchMode: PasteMatchMode;
    onClose: () => void;
    onDeleted: (ids: string[]) => void;
};

const PREVIEW_PAGE_SIZE = 10;

const MODE_LABELS: Record<BulkDeleteMode, string> = {
    all: 'All pastes',
    permanent: 'Permanent',
    temporary: 'Temporary',
    filtered: 'Filtered',
    selected: 'Selected',
};

function isPermanent(paste: Paste): boolean {
    return String(paste.permanent) === 'true' || paste.permanent === true;
}

function modeDescription(mode: BulkDeleteMode, selectedCount: number): string {
    switch (mode) {
        case 'all':
            return 'every paste currently in this view';
        case 'permanent':
            return 'every permanent paste in this view';
        case 'temporary':
            return 'every temporary paste in this view';
        case 'filtered':
            return 'every paste matching the active filters';
        case 'selected':
            return `${selectedCount} selected paste${selectedCount === 1 ? '' : 's'}`;
    }
}

// Two-step bulk delete. The toolbar never carries destructive buttons: the
// modal is the only place a deletion can start, it previews the exact set for
// the chosen mode and the final call always sends `confirm: true`.
export default function BulkDeleteModal({
    defaultMode,
    selectedIds,
    selectedRows,
    scope,
    query,
    filterRules,
    matchMode,
    onClose,
    onDeleted,
}: BulkDeleteModalProps) {
    const [mode, setMode] = useState<BulkDeleteMode>(defaultMode);
    const [stage, setStage] = useState<1 | 2>(1);
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const [previewItems, setPreviewItems] = useState<Paste[]>([]);
    const [previewTotal, setPreviewTotal] = useState(0);
    const [previewLoading, setPreviewLoading] = useState(true);
    const [previewPage, setPreviewPage] = useState(1);

    const hasFilterContext = query.trim().length > 0 || filterRules.length > 0;
    const isSelectedMode = mode === 'selected';

    const modeAvailable: Record<BulkDeleteMode, boolean> = {
        all: true,
        permanent: true,
        temporary: true,
        filtered: hasFilterContext,
        selected: selectedIds.length > 0,
    };

    const buildParams = useCallback(
        (targetMode: BulkDeleteMode, page: number) => {
            const params = new URLSearchParams({
                scope,
                page: String(page),
                limit: String(PREVIEW_PAGE_SIZE),
                force: '1',
            });
            if (targetMode === 'permanent') params.set('type', 'permanent');
            else if (targetMode === 'temporary') params.set('type', 'temporary');
            else if (targetMode === 'filtered') {
                const text = query.trim();
                if (text) params.set('filter', text);
                if (filterRules.length > 0) {
                    params.set('filterRules', JSON.stringify(filterRules));
                    params.set('matchMode', matchMode);
                }
            }
            return params.toString();
        },
        [scope, query, filterRules, matchMode]
    );

    const runPreview = useCallback(
        async (targetMode: BulkDeleteMode, page: number) => {
            setPreviewLoading(true);
            try {
                const response = await fetch(`/api/pastes?${buildParams(targetMode, page)}`);
                if (!response.ok) throw new Error('preview');
                const body = await response.json();
                setPreviewItems(Array.isArray(body.items) ? body.items : []);
                setPreviewTotal(typeof body.total === 'number' ? body.total : 0);
                setPreviewPage(page);
            } catch {
                setPreviewItems([]);
                setPreviewTotal(0);
            } finally {
                setPreviewLoading(false);
            }
        },
        [buildParams]
    );

    // Every mode change restarts the preview from page 1.
    useEffect(() => {
        setStage(1);
        setPreviewPage(1);
        if (mode === 'selected') {
            setPreviewLoading(false);
            return;
        }
        void runPreview(mode, 1);
    }, [mode, runPreview]);

    const selectedPageItems = useMemo(
        () => selectedRows.slice((previewPage - 1) * PREVIEW_PAGE_SIZE, previewPage * PREVIEW_PAGE_SIZE),
        [selectedRows, previewPage]
    );
    const rows = isSelectedMode ? selectedPageItems : previewItems;
    const total = isSelectedMode ? selectedRows.length : previewTotal;
    const totalPages = Math.max(1, Math.ceil(total / PREVIEW_PAGE_SIZE));

    const goToPreviewPage = (page: number) => {
        if (isSelectedMode) setPreviewPage(page);
        else void runPreview(mode, page);
    };

    const handleDelete = async () => {
        if (confirmText.trim().toUpperCase() !== 'DELETE') return;
        setBusy(true);
        setError(null);
        try {
            const body: Record<string, unknown> = { confirm: true, scope };
            if (mode === 'selected') {
                body.ids = selectedIds;
            } else if (mode === 'filtered') {
                body.type = 'all';
                if (query.trim()) body.filter = query.trim();
                if (filterRules.length > 0) {
                    body.filterRules = filterRules;
                    body.matchMode = matchMode;
                }
            } else {
                body.type = mode;
            }

            const response = await fetch('/api/pastes', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) {
                const failure = await response.json().catch(() => ({}));
                setError(failure.error || failure.message || 'Deletion failed.');
                setBusy(false);
                return;
            }
            const data = await response.json().catch(() => ({}));
            onDeleted(Array.isArray(data.ids) ? data.ids : []);
            onClose();
        } catch {
            setError('Deletion failed.');
            setBusy(false);
        }
    };

    const previewColumns: TableColumn<Paste>[] = [
        { key: 'name', header: 'Name', render: (row) => <span className="dash-cell-truncate">{row.name || 'Untitled'}</span> },
        {
            key: 'id',
            header: 'UUID',
            render: (row) => <span className="dash-mono-id">{row.id}</span>,
        },
        {
            key: 'permanent',
            header: 'Type',
            render: (row) => (isPermanent(row) ? <Badge tone="permanent">permanent</Badge> : <Badge>temporary</Badge>),
        },
    ];

    return (
        <div className="dash-modal-backdrop" onClick={onClose}>
            <div
                className="dash-modal dash-modal--wide"
                role="dialog"
                aria-modal="true"
                aria-label="Delete pastes"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="dash-modal-head">
                    <h2 className="dash-modal-title">{stage === 1 ? 'Delete pastes' : 'Final confirmation'}</h2>
                    <button type="button" className="dash-icon-btn" aria-label="Close" onClick={onClose}>
                        ×
                    </button>
                </div>

                {stage === 1 ? (
                    <>
                        <div className="dash-mode-tabs" role="tablist" aria-label="Deletion mode">
                            {(Object.keys(MODE_LABELS) as BulkDeleteMode[]).map((option) => (
                                <button
                                    key={option}
                                    type="button"
                                    role="tab"
                                    aria-selected={mode === option}
                                    className={`dash-mode-tab ${mode === option ? 'dash-mode-tab--active' : ''}`.trim()}
                                    disabled={!modeAvailable[option]}
                                    title={modeAvailable[option] ? undefined : 'Not available with the current view'}
                                    onClick={() => setMode(option)}
                                >
                                    {MODE_LABELS[option]}
                                </button>
                            ))}
                        </div>

                        <p className="dash-modal-desc">
                            About to delete <strong>{modeDescription(mode, selectedIds.length)}</strong>.
                        </p>

                        {mode === 'filtered' && hasFilterContext && (
                            <p className="dash-note" style={{ marginBottom: 'var(--dash-space-3)' }}>
                                Filters applied: {query.trim() ? `text “${query.trim()}”` : 'advanced rules'}
                                {query.trim() && filterRules.length > 0 ? ' + advanced rules' : ''}.
                            </p>
                        )}

                        {previewLoading ? (
                            <p className="dash-note">Loading preview…</p>
                        ) : (
                            <>
                                <Table
                                    columns={previewColumns}
                                    rows={rows}
                                    rowKey={(row) => row.id}
                                    compact
                                    empty={<div className="dash-empty">Nothing matches this mode.</div>}
                                />
                                <div className="dash-pagination">
                                    <Button size="sm" variant="ghost" disabled={previewPage <= 1} onClick={() => goToPreviewPage(previewPage - 1)}>
                                        Prev
                                    </Button>
                                    <span>
                                        Page {previewPage} of {totalPages}
                                    </span>
                                    <Button
                                        size="sm"
                                        variant="ghost"
                                        disabled={previewPage >= totalPages}
                                        onClick={() => goToPreviewPage(previewPage + 1)}
                                    >
                                        Next
                                    </Button>
                                    <span className="dash-muted">
                                        {total} paste{total === 1 ? '' : 's'} will be deleted
                                    </span>
                                </div>
                            </>
                        )}

                        <Callout tone="danger">
                            <strong>Bulk deletes are irreversible.</strong> Review the preview before continuing.
                        </Callout>

                        <div className="dash-modal-actions">
                            <Button variant="ghost" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button variant="danger" onClick={() => setStage(2)} disabled={previewLoading || total === 0}>
                                Continue
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <Callout tone="danger">
                            This is the final step. Type <strong>DELETE</strong> to permanently remove{' '}
                            <strong>{total}</strong> paste{total === 1 ? '' : 's'}.
                        </Callout>
                        <div style={{ marginTop: 'var(--dash-space-4)' }}>
                            <Input
                                autoFocus
                                placeholder="Type DELETE to confirm"
                                value={confirmText}
                                onChange={(event) => setConfirmText(event.target.value)}
                                aria-label="Type DELETE to confirm"
                            />
                        </div>
                        {error && (
                            <p className="dash-danger-text" style={{ marginTop: 'var(--dash-space-3)' }}>
                                {error}
                            </p>
                        )}
                        <p className="dash-note" style={{ marginTop: 'var(--dash-space-3)' }}>
                            Bulk deletes are irreversible.
                        </p>
                        <div className="dash-modal-actions">
                            <Button variant="ghost" onClick={() => setStage(1)}>
                                Back
                            </Button>
                            <Button
                                variant="danger"
                                onClick={() => void handleDelete()}
                                disabled={busy || confirmText.trim().toUpperCase() !== 'DELETE'}
                            >
                                {busy ? 'Deleting…' : `Delete ${total} permanently`}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
