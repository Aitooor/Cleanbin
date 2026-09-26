import { useCallback, useEffect, useRef, useState } from 'react';
import type { PagedResponse, Paste } from './types';

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
    updateName: (id: string, name: string) => void;
};

// Owns the paged paste listing: one request per page against
// /api/pastes?page=N&limit=pageSize, with a request guard so a slow response
// never overwrites a newer page.
export function usePastes(pageSize = 50): UsePastesResult {
    const [page, setPage] = useState(1);
    const [items, setItems] = useState<Paste[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const requestId = useRef(0);

    const load = useCallback(
        async (targetPage: number, force = false) => {
            const id = ++requestId.current;
            setLoading(true);
            setError(null);
            try {
                const forceParam = force ? '&force=1' : '';
                const response = await fetch(`/api/pastes?page=${targetPage}&limit=${pageSize}${forceParam}`);
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
        [pageSize]
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

    const updateName = useCallback((id: string, name: string) => {
        setItems((prev) => prev.map((paste) => (paste.id === id ? { ...paste, name } : paste)));
    }, []);

    return { items, total, page, pageSize, totalPages, loading, error, setPage, refresh, removeIds, updateName };
}
