import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PagedResponse, Paste, PasteListQuery } from './types';

export type UsePastesResult = {
    items: Paste[];
    total: number;
    page: number;
    pageSize: number;
    totalPages: number;
    loading: boolean;
    error: string | null;
    setPage: (page: number) => void;
    refresh: () => void;
    removeIds: (ids: string[]) => void;
    updatePaste: (id: string, patch: Partial<Paste>) => void;
    updateName: (id: string, name: string) => void;
};

// Serialises the listing query into the exact set of API params the server
// understands. Scope, free text, advanced rules, match mode and sort are all
// applied server-side so the page only ever renders what the API returned.
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

// Owns the paged paste listing: one request per (query, page) against
// /api/pastes, with a request guard so a slow response never overwrites a newer
// page. A query change always restarts from page 1.
export function usePastes(pageSize: number, query: PasteListQuery): UsePastesResult {
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<Paste[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const requestId = useRef(0);

    const baseQuery = useMemo(() => buildPasteQueryParams(query), [query]);
    const queryKey = `${pageSize}|${baseQuery}`;

    // Adjusting state during render: when the query changes the current page is
    // no longer valid, so snap back to page 1 in the same commit and avoid a
    // wasted request for the stale page.
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
                const body = (await response.json()) as PagedResponse<Paste>;
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

    const updatePaste = useCallback((id: string, patch: Partial<Paste>) => {
        setItems((prev) => prev.map((paste) => (paste.id === id ? { ...paste, ...patch } : paste)));
    }, []);

    const updateName = useCallback(
        (id: string, name: string) => {
            updatePaste(id, { name });
        },
        [updatePaste]
    );

    return { items, total, page, pageSize, totalPages, loading, error, setPage, refresh, removeIds, updatePaste, updateName };
}
