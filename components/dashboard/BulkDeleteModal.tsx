import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Paste } from './types';
import type { TableColumn } from './types';
import { Badge, Button, Callout, Input, Select, Table } from './ui';

export type BulkDeleteMode = 'all' | 'permanent' | 'temporary' | 'filtered' | 'selected';

export type BulkDeleteRequest = {
    mode: BulkDeleteMode;
    filter?: string;
    filterField?: string;
};

type FilterRule = {
    uid: string;
    field: 'any' | 'name' | 'content' | 'id';
    op: 'contains' | 'exact' | 'starts' | 'regex';
    value: string;
    negate: boolean;
    regexValid: boolean;
    regexError: string;
};

const PREVIEW_PAGE_SIZES = [5, 10, 25, 50];

const MODE_LABELS: Record<BulkDeleteMode, string> = {
    all: 'all',
    permanent: 'all permanent',
    temporary: 'all temporary',
    filtered: 'filtered',
    selected: 'selected',
};

function newRule(): FilterRule {
    return {
        uid: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        field: 'any',
        op: 'contains',
        value: '',
        negate: false,
        regexValid: true,
        regexError: '',
    };
}

function validateRegex(rule: FilterRule, value: string): FilterRule {
    if (rule.op !== 'regex') return { ...rule, value, regexValid: true, regexError: '' };
    try {
        new RegExp(value);
        return { ...rule, value, regexValid: true, regexError: '' };
    } catch (error) {
        return { ...rule, value, regexValid: false, regexError: error instanceof Error ? error.message : 'Invalid regex' };
    }
}

type BulkDeleteModalProps = {
    request: BulkDeleteRequest;
    selectedIds: string[];
    onClose: () => void;
    onDeleted: (ids: string[]) => void;
    onAddToSelection: (ids: string[]) => void;
};

// Two-step bulk delete with the exact API contract used before: the modal is
// the confirmation, the final call always sends `confirm: true`, and bulk
// removal goes through DELETE /api/pastes.
export default function BulkDeleteModal({ request, selectedIds, onClose, onDeleted, onAddToSelection }: BulkDeleteModalProps) {
    const [stage, setStage] = useState<1 | 2>(1);
    const [filter, setFilter] = useState(request.filter ?? '');
    const [filterRules, setFilterRules] = useState<FilterRule[]>([]);
    const [matchMode, setMatchMode] = useState<'AND' | 'OR'>('AND');
    const [confirmText, setConfirmText] = useState('');
    const [busy, setBusy] = useState(false);

    const [previewItems, setPreviewItems] = useState<Paste[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [previewCount, setPreviewCount] = useState<number | null>(null);
    const [previewSelectedIds, setPreviewSelectedIds] = useState<Set<string>>(new Set());
    const [addedFromPreviewIds, setAddedFromPreviewIds] = useState<Set<string>>(new Set());
    const [previewPage, setPreviewPage] = useState(1);
    const [previewPageSize, setPreviewPageSize] = useState(10);
    const [addedPicksCount, setAddedPicksCount] = useState(0);
    const [showStayOrClose, setShowStayOrClose] = useState(false);

    const [summaryTotal, setSummaryTotal] = useState<number | null>(null);
    const [summaryLoading, setSummaryLoading] = useState(false);

    const isFiltered = request.mode === 'filtered';

    const buildQuery = useCallback(
        (limit: number, page: number) => {
            const params = new URLSearchParams({
                preview: '1',
                page: String(page),
                limit: String(limit),
                force: '1',
                matchMode,
            });
            if (filterRules.length > 0) params.set('filterRules', JSON.stringify(filterRules));
            else if (filter.trim()) {
                params.set('filter', filter);
                if (request.filterField) params.set('filterField', request.filterField);
            }
            return params.toString();
        },
        [filter, filterRules, matchMode, request.filterField]
    );

    const runPreview = useCallback(
        async (page: number, limit: number) => {
            setPreviewLoading(true);
            try {
                const response = await fetch(`/api/pastes?${buildQuery(limit, page)}`);
                if (!response.ok) throw new Error('preview');
                const body = await response.json();
                setPreviewItems(Array.isArray(body.items) ? body.items : []);
                setPreviewCount(typeof body.total === 'number' ? body.total : (body.items?.length ?? 0));
                setPreviewPage(page);
            } catch {
                setPreviewCount(0);
                setPreviewItems([]);
            } finally {
                setPreviewLoading(false);
            }
        },
        [buildQuery]
    );

    // Auto-preview when the modal opens in filtered mode, mirroring the old
    // behaviour where the match count showed up right away.
    useEffect(() => {
        if (isFiltered) void runPreview(1, previewPageSize);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isFiltered]);

    const updateRule = (uid: string, patch: Partial<FilterRule>) => {
        setFilterRules((prev) => prev.map((rule) => (rule.uid === uid ? { ...rule, ...patch } : rule)));
    };

    const removeRule = (uid: string) => {
        setFilterRules((prev) => prev.filter((rule) => rule.uid !== uid));
    };

    const handleContinue = async () => {
        setSummaryLoading(true);
        try {
            const response = await fetch(`/api/pastes?${buildQuery(200, 1)}`);
            const body = response.ok ? await response.json() : {};
            setSummaryTotal(typeof body.total === 'number' ? body.total : null);
        } catch {
            setSummaryTotal(null);
        } finally {
            setSummaryLoading(false);
            setStage(2);
        }
    };

    const handleAddPicks = () => {
        const ids = Array.from(previewSelectedIds);
        onAddToSelection(ids);
        setAddedFromPreviewIds((prev) => {
            const next = new Set(prev);
            ids.forEach((id) => next.add(id));
            return next;
        });
        setPreviewSelectedIds(new Set());
        setAddedPicksCount(ids.length);
        setShowStayOrClose(true);
    };

    const handleDelete = async () => {
        if (confirmText.trim().toUpperCase() !== 'DELETE') return;
        setBusy(true);
        try {
            const body: Record<string, unknown> = { confirm: true };
            if (request.mode === 'selected') {
                body.ids = selectedIds;
            } else if (request.mode === 'filtered') {
                body.filter = filter;
                if (request.filterField) body.filterField = request.filterField;
                if (filterRules.length > 0) body.filterRules = filterRules;
                body.matchMode = matchMode;
                body.type = 'all';
            } else {
                body.type = request.mode;
            }

            const response = await fetch('/api/pastes', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (!response.ok) throw new Error('delete');
            const data = await response.json().catch(() => ({}));
            onDeleted(Array.isArray(data.ids) ? data.ids : []);
            onClose();
        } catch {
            // Surface failures through the caller by keeping the modal open.
            setBusy(false);
        }
    };

    const previewTotalPages = Math.max(1, Math.ceil(previewItems.length / previewPageSize));
    const pagePreviewItems = useMemo(
        () => previewItems.slice((previewPage - 1) * previewPageSize, previewPage * previewPageSize),
        [previewItems, previewPage, previewPageSize]
    );

    const previewColumns: TableColumn<Paste>[] = [
        { key: 'name', header: 'Name', render: (row) => <span className="dash-cell-truncate">{row.name}</span> },
        {
            key: 'id',
            header: 'UUID',
            render: (row) => (
                <button
                    type="button"
                    className="dash-mono-id"
                    title="Copy UUID"
                    onClick={() => navigator.clipboard?.writeText(row.id)}
                >
                    {row.id}
                </button>
            ),
        },
        {
            key: 'permanent',
            header: 'Permanent',
            render: (row) => (String(row.permanent) === 'true' ? <Badge tone="permanent">yes</Badge> : <span className="dash-faint">no</span>),
        },
        {
            key: 'select',
            header: '',
            align: 'right',
            render: (row) =>
                addedFromPreviewIds.has(row.id) ? (
                    <span className="dash-faint">added</span>
                ) : (
                    <label className="dash-row" style={{ gap: 6 }}>
                        <input
                            type="checkbox"
                            className="dash-checkbox"
                            checked={previewSelectedIds.has(row.id)}
                            onChange={() =>
                                setPreviewSelectedIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(row.id)) next.delete(row.id);
                                    else next.add(row.id);
                                    return next;
                                })
                            }
                            aria-label={`Select ${row.name}`}
                        />
                    </label>
                ),
        },
    ];

    return (
        <div className="dash-modal-backdrop" onClick={onClose}>
            <div
                className="dash-modal dash-modal--wide"
                role="dialog"
                aria-modal="true"
                aria-label="Confirm deletion"
                onClick={(event) => event.stopPropagation()}
            >
                <div className="dash-modal-head">
                    <h2 className="dash-modal-title">{stage === 1 ? 'Confirm deletion' : 'Final confirmation'}</h2>
                    <button type="button" className="dash-icon-btn" aria-label="Close" onClick={onClose}>
                        ×
                    </button>
                </div>

                {stage === 1 ? (
                    <>
                        <p className="dash-modal-desc">
                            About to delete <strong>{request.mode === 'selected' ? selectedIds.length : MODE_LABELS[request.mode]}</strong>{' '}
                            items. This action is irreversible.
                        </p>

                        {isFiltered && (
                            <div className="dash-stack" style={{ marginBottom: 'var(--dash-space-4)' }}>
                                <div className="dash-row">
                                    <span className="dash-label">Combine rules</span>
                                    <Select value={matchMode} onChange={(event) => setMatchMode(event.target.value as 'AND' | 'OR')} aria-label="Combine rules">
                                        <option value="AND">All rules (AND)</option>
                                        <option value="OR">Any rule (OR)</option>
                                    </Select>
                                    <Input
                                        className="dash-grow"
                                        placeholder="Filter text"
                                        value={filter}
                                        onChange={(event) => setFilter(event.target.value)}
                                        aria-label="Filter text"
                                    />
                                </div>

                                {filterRules.map((rule) => (
                                    <div key={rule.uid} className="dash-row">
                                        <Select value={rule.field} onChange={(event) => updateRule(rule.uid, { field: event.target.value as FilterRule['field'] })} aria-label="Field">
                                            <option value="any">Any</option>
                                            <option value="name">Name</option>
                                            <option value="content">Content</option>
                                            <option value="id">ID</option>
                                        </Select>
                                        <Select value={rule.op} onChange={(event) => updateRule(rule.uid, { op: event.target.value as FilterRule['op'] })} aria-label="Operator">
                                            <option value="contains">Contains</option>
                                            <option value="exact">Exact</option>
                                            <option value="starts">Starts with</option>
                                            <option value="regex">Regex</option>
                                        </Select>
                                        <Input
                                            className="dash-grow"
                                            placeholder='value ("-" to negate)'
                                            value={rule.value}
                                            onChange={(event) => updateRule(rule.uid, validateRegex(rule, event.target.value))}
                                            aria-label="Value"
                                        />
                                        <label className="dash-row" style={{ gap: 6 }}>
                                            <input
                                                type="checkbox"
                                                className="dash-checkbox"
                                                checked={rule.negate}
                                                onChange={(event) => updateRule(rule.uid, { negate: event.target.checked })}
                                            />
                                            <span className="dash-muted">Negate</span>
                                        </label>
                                        <Button size="sm" variant="ghost" onClick={() => removeRule(rule.uid)}>
                                            Remove
                                        </Button>
                                        {!rule.regexValid && <span className="dash-danger-text">{rule.regexError || 'Invalid regex'}</span>}
                                    </div>
                                ))}

                                <div className="dash-row">
                                    <Button size="sm" onClick={() => setFilterRules((prev) => [...prev, newRule()])}>
                                        Add rule
                                    </Button>
                                    <Button size="sm" variant="ghost" onClick={() => setFilterRules([])}>
                                        Clear rules
                                    </Button>
                                    <Button size="sm" variant="primary" onClick={() => runPreview(1, previewPageSize)} disabled={previewLoading}>
                                        Preview matches
                                    </Button>
                                    {previewCount != null && <span className="dash-muted">{previewCount} matches</span>}
                                </div>

                                {previewCount != null && (
                                    <div>
                                        <Table
                                            columns={previewColumns}
                                            rows={pagePreviewItems}
                                            rowKey={(row) => row.id}
                                            loading={previewLoading}
                                            compact
                                            empty={<div className="dash-empty">No matches</div>}
                                        />
                                        <div className="dash-pagination">
                                            <Button size="sm" variant="ghost" disabled={previewPage <= 1} onClick={() => void runPreview(previewPage - 1, previewPageSize)}>
                                                Prev
                                            </Button>
                                            <span>
                                                Page {previewPage} / {previewTotalPages}
                                            </span>
                                            <Button
                                                size="sm"
                                                variant="ghost"
                                                disabled={previewPage >= previewTotalPages}
                                                onClick={() => void runPreview(previewPage + 1, previewPageSize)}
                                            >
                                                Next
                                            </Button>
                                            <Select
                                                value={String(previewPageSize)}
                                                onChange={(event) => {
                                                    const size = Number(event.target.value);
                                                    setPreviewPageSize(size);
                                                    void runPreview(1, size);
                                                }}
                                                aria-label="Preview page size"
                                            >
                                                {PREVIEW_PAGE_SIZES.map((size) => (
                                                    <option key={size} value={size}>
                                                        {size} / page
                                                    </option>
                                                ))}
                                            </Select>
                                            <Button size="sm" variant="permanent" onClick={handleAddPicks} disabled={previewSelectedIds.size === 0}>
                                                Add picks to Selected ({previewSelectedIds.size})
                                            </Button>
                                        </div>
                                        {showStayOrClose && (
                                            <div className="dash-row" style={{ marginTop: 'var(--dash-space-2)' }}>
                                                <span className="dash-muted">
                                                    {addedPicksCount} item{addedPicksCount === 1 ? '' : 's'} added to Selected.
                                                </span>
                                                <Button size="sm" variant="ghost" onClick={() => setShowStayOrClose(false)}>
                                                    Stay here
                                                </Button>
                                                <Button size="sm" variant="primary" onClick={onClose}>
                                                    Close modal
                                                </Button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        )}

                        <div className="dash-modal-actions">
                            <Button variant="ghost" onClick={onClose}>
                                Cancel
                            </Button>
                            <Button variant="danger" onClick={() => void handleContinue()} disabled={summaryLoading}>
                                {summaryLoading ? 'Preparing...' : 'Preview sample & continue'}
                            </Button>
                        </div>
                    </>
                ) : (
                    <>
                        <Callout tone="danger">
                            This is the final confirmation. Type <strong>DELETE</strong> to permanently remove the matched pastes.
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
                        <p className="dash-note" style={{ marginTop: 'var(--dash-space-3)' }}>
                            {summaryTotal != null ? `${summaryTotal} item${summaryTotal === 1 ? '' : 's'} will be deleted.` : 'Up to 200 sample items were inspected.'}
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
                                {busy ? 'Deleting...' : 'Delete permanently'}
                            </Button>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}
