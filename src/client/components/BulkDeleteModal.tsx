import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Modal } from './CleanUi';
import type {
  ListedPaste,
  PasteFilterRule,
  PasteMatchMode,
  PasteScope,
} from '../../shared/types';

export type BulkDeleteMode = 'all' | 'permanent' | 'temporary' | 'filtered' | 'selected';

type BulkDeleteModalProps = {
  defaultMode: BulkDeleteMode;
  selectedIds: string[];
  selectedRows: ListedPaste[];
  scope: PasteScope;
  query: string;
  filterRules: PasteFilterRule[];
  matchMode: PasteMatchMode;
  onClose: () => void;
  onDeleted: (ids: string[]) => void;
};

const PREVIEW_PAGE_SIZE = 10;

const MODE_LABELS: Record<BulkDeleteMode, string> = {
  all: 'all',
  permanent: 'permanent',
  temporary: 'temporary',
  filtered: 'filtered',
  selected: 'selected',
};

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

  const [previewItems, setPreviewItems] = useState<ListedPaste[]>([]);
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
        if (!response.ok) throw new Error('preview failed');
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

  return (
    <Modal
      title={stage === 1 ? 'delete pastes' : 'confirm deletion'}
      wide
      onClose={onClose}
      footer={
        stage === 1 ? (
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="danger" disabled={previewLoading || total === 0} onClick={() => setStage(2)}>
              Continue ({total})
            </Button>
          </>
        ) : (
          <>
            <Button onClick={() => setStage(1)} disabled={busy}>
              Back
            </Button>
            <Button
              variant="danger"
              disabled={busy || confirmText.trim().toUpperCase() !== 'DELETE'}
              onClick={() => void handleDelete()}
            >
              {busy ? 'Deleting…' : `Delete ${total} permanently`}
            </Button>
          </>
        )
      }
    >
      {stage === 1 ? (
        <>
          <div className="cb-tabs">
            {(Object.keys(MODE_LABELS) as BulkDeleteMode[]).map((option) => (
              <button
                key={option}
                type="button"
                className={`cb-tab ${mode === option ? 'cb-tab--active' : ''}`.trim()}
                disabled={!modeAvailable[option]}
                onClick={() => setMode(option)}
              >
                {MODE_LABELS[option]}
              </button>
            ))}
          </div>

          {previewLoading ? (
            <div className="cb-section-sub">Loading preview…</div>
          ) : rows.length === 0 ? (
            <div className="cb-empty">Nothing matches this mode.</div>
          ) : (
            <>
              <div className="cb-table-wrap">
                <table className="cb-table">
                  <thead>
                    <tr>
                      <th>name</th>
                      <th>uuid</th>
                      <th>type</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row) => (
                      <tr key={row.id}>
                        <td>
                          <span className="cb-truncate">{row.name || 'untitled'}</span>
                        </td>
                        <td style={{ color: '#888' }} title={row.id}>
                          {row.id.slice(0, 8)}
                        </td>
                        <td>
                          <span className={`cb-tag ${row.permanent ? 'cb-tag--perm' : ''}`}>
                            {row.permanent ? 'perm' : 'temp'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="cb-pagination">
                <span>
                  {total} paste{total === 1 ? '' : 's'} · page {previewPage}/{totalPages}
                </span>
                <Button size="sm" disabled={previewPage <= 1} onClick={() => goToPreviewPage(previewPage - 1)}>
                  prev
                </Button>
                <Button
                  size="sm"
                  disabled={previewPage >= totalPages}
                  onClick={() => goToPreviewPage(previewPage + 1)}
                >
                  next
                </Button>
              </div>
            </>
          )}
        </>
      ) : (
        <>
          <div className="cb-notice cb-notice--danger">
            Irreversible action. Type <strong>DELETE</strong> to remove {total} paste
            {total === 1 ? '' : 's'}.
          </div>
          <input
            className="cb-input"
            placeholder="Type DELETE to confirm"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            autoFocus
          />
          {error && <div className="cb-notice cb-notice--danger">{error}</div>}
        </>
      )}
    </Modal>
  );
}
