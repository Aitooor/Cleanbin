import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ListedPaste, PagedResponse, PasteListQuery } from '../../shared/types';

export function buildPasteQueryParams(query: PasteListQuery): string {
  const params = new URLSearchParams();
  params.set('scope', query.scope);
  const text = query.query.trim();
  if (text) params.set('filter', text);
  if (query.filterRules.length > 0) {
    params.set('filterRules', JSON.stringify(query.filterRules));
    params.set('matchMode', query.matchMode);
  }
  if (query.sort) {
    params.set('sort', query.sort);
    params.set('dir', query.dir);
  }
  return params.toString();
}

export function usePastes(pageSize: number, query: PasteListQuery) {
  const [page, setPage] = useState(1);
  const [items, setItems] = useState<ListedPaste[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const baseQuery = useMemo(() => buildPasteQueryParams(query), [query]);
  const queryKey = `${pageSize}|${baseQuery}`;

  const previousKey = useRef(queryKey);
  if (previousKey.current !== queryKey) {
    previousKey.current = queryKey;
    if (page !== 1) setPage(1);
  }

  const load = useCallback(
    async (targetPage: number, force = false) => {
      const id = ++requestId.current;
      setLoading(true);
      setError(null);
      try {
        const forceParam = force ? '&force=1' : '';
        const response = await fetch(`/api/pastes?page=${targetPage}&limit=${pageSize}&${baseQuery}${forceParam}`);
        if (!response.ok) throw new Error('Failed to load pastes');
        const body = (await response.json()) as PagedResponse<ListedPaste>;
        if (id !== requestId.current) return;
        setItems(Array.isArray(body.items) ? body.items : []);
        setTotal(typeof body.total === 'number' && body.total >= 0 ? body.total : 0);
      } catch {
        if (id !== requestId.current) return;
        setItems([]);
        setError('Failed to load pastes.');
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    },
    [baseQuery, pageSize]
  );

  useEffect(() => {
    void load(page);
  }, [page, load]);

  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const refresh = useCallback(() => {
    void load(page, true);
  }, [load, page]);

  const removeIds = useCallback((ids: string[]) => {
    const removed = new Set(ids);
    setItems((prev) => prev.filter((paste) => !removed.has(paste.id)));
  }, []);

  const updatePaste = useCallback((id: string, patch: Partial<ListedPaste>) => {
    setItems((prev) => prev.map((paste) => (paste.id === id ? { ...paste, ...patch } : paste)));
  }, []);

  return { items, total, page, pageSize, totalPages, loading, error, setPage, refresh, removeIds, updatePaste };
}
