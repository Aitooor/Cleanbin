import React, { useState, useEffect } from 'react';
// Using simple list rendering for stability (virtualization removed temporarily)
import { useRouter } from 'next/router';
import { useNotification } from 'components/NotificationProvider';
import { FaTrash, FaClipboard, FaEye } from 'react-icons/fa';
import { FiLogOut } from 'react-icons/fi';
import type { GetServerSideProps } from 'next';
import { parse } from 'cookie';

type DashboardProps = {};

const Dashboard: React.FC<DashboardProps> = () => {
    const [pastes, setPastes] = useState<Paste[]>([]);
    const [searchTerm, setSearchTerm] = useState(''); // Estado para el término de búsqueda
    const [filteredPastes, setFilteredPastes] = useState<Paste[]>([]); // Estado para los pastes filtrados
    const [showRenameModal, setShowRenameModal] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const [renameTargetId, setRenameTargetId] = useState<string | null>(null);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();
    const { addNotification } = useNotification();
    const [limit] = useState(50);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [nextToken, setNextToken] = useState<string | null | undefined>(undefined);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [deletePayload, setDeletePayload] = useState<any>(null);
    const [confirmStage, setConfirmStage] = useState(0);
    const [previewItems, setPreviewItems] = useState<any[]>([]);
    const [previewLoading, setPreviewLoading] = useState(false);
    const [showPreviewList, setShowPreviewList] = useState(false);
    const [previewPage, setPreviewPage] = useState(1);
    const [previewPageSize, setPreviewPageSize] = useState(10);
    const sentinelRef = React.useRef<HTMLDivElement | null>(null);
    // simpler: always render fallback list

    // no dynamic import

    useEffect(() => {
        setMounted(true);
    }, []);

    // Fetch paged pastes; force bypasses server-side cache when needed.
    const fetchPastes = async (force = false) => {
        try {
            if (!force) setLoading(true);
            const forceParam = force ? '&force=1' : '';
            const response = await fetch(`/api/pastes?page=1&limit=${limit}${forceParam}`);
            if (response.ok) {
                const body = await response.json();
                const items: Paste[] = body.items || [];
                setPastes(items);
                setFilteredPastes(items);
                if (typeof body.total === 'number' && body.total >= 0) setTotal(body.total);
                setNextToken(body.nextPageToken ?? null);
            }
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchPastes(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [limit]);

    // Polling removed — dashboard relies on BroadcastChannel for real-time updates.

    useEffect(() => {
        // Filtrar los pastes según el término de búsqueda
        setFilteredPastes(
            pastes.filter(
                (paste) =>
                    paste &&
                    paste.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    paste.content?.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    paste.id?.toLowerCase().includes(searchTerm.toLowerCase()) // Filtrar por UUID
            )
        );
    }, [searchTerm, pastes]);

    // infinite scroll observer
    const loadMore = async () => {
        if (loadingMore) return;
        try {
            setLoadingMore(true);
            // if we have a token, use token-based paging; otherwise use page param (backend supports both)
            const tokenParam = nextToken ? `&token=${encodeURIComponent(nextToken)}` : '';
            const response = await fetch(`/api/pastes?page=1&limit=${limit}${tokenParam}`);
            if (response.ok) {
                const body = await response.json();
                const items: Paste[] = body.items || [];
                setPastes((prev) => {
                    const merged = [...prev, ...items];
                    setFilteredPastes(merged);
                    return merged;
                });
                if (typeof body.total === 'number' && body.total >= 0) setTotal(body.total);
                setNextToken(body.nextPageToken ?? null);
            }
        } finally {
            setLoadingMore(false);
        }
    };

    useEffect(() => {
        if (!sentinelRef.current) return;
        const obs = new IntersectionObserver(
            (entries) => {
                entries.forEach((entry) => {
                    if (entry.isIntersecting && !loadingMore) {
                        // If there are no pastes at all, don't repeatedly trigger loadMore.
                        if (total === 0 && pastes.length === 0) return;
                        // if total is known and we've loaded all, do nothing
                        if (total > 0 && pastes.length >= total) return;
                        if (nextToken === null && total > 0 && pastes.length >= total) return;
                        loadMore();
                    }
                });
            },
            { root: null, rootMargin: '200px', threshold: 0.1 }
        );
        obs.observe(sentinelRef.current);
        return () => obs.disconnect();
    }, [sentinelRef.current, loadingMore, pastes.length, total, nextToken]);

    // Listen for BroadcastChannel messages from other tabs and refresh quickly.
    // If BroadcastChannel is not available, fall back to light polling every 30s.
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        let fallbackInterval: number | null = null;
        // dynamic import to avoid SSR issues
        import('../utils/broadcast')
            .then((mod) => {
                try {
                    const bc = mod.getBroadcastChannel();
                    if (bc) {
                        cleanup = mod.listen(async (msg) => {
                            if (!msg) return;
                            if (msg.type === 'paste_created' || msg.type === 'paste_deleted' || msg.type === 'paste_renamed') {
                                // quick forced fetch to update UI
                                await fetchPastes(true);
                            }
                        });
                        return;
                    }
                } catch (err) {
                    // ignore and start fallback
                }
                // BroadcastChannel not available: start fallback polling every 30s
                fallbackInterval = window.setInterval(async () => {
                    if (document.visibilityState === 'hidden') return;
                    await fetchPastes(true);
                }, 30000);
            })
            .catch(() => {
                // import failed: start fallback polling
                fallbackInterval = window.setInterval(async () => {
                    if (document.visibilityState === 'hidden') return;
                    await fetchPastes(true);
                }, 30000);
            });

        return () => {
            if (cleanup) cleanup();
            if (fallbackInterval) clearInterval(fallbackInterval);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Debounced preview fetch for filtered delete modal
    useEffect(() => {
        if (!showDeleteModal || !deletePayload || deletePayload.mode !== 'filtered' || confirmStage !== 1) return;
        let mounted = true;
        let timer: number | undefined;
        // reset to first page when filter changes
        setPreviewPage(1);
        const doPreview = async () => {
            try {
                setPreviewLoading(true);
                const q = deletePayload.filter || '';
                const response = await fetch(`/api/pastes?page=1&limit=1000&force=1`);
                if (!response.ok) {
                    if (mounted) addNotification('Failed to preview matches.');
                    return;
                }
                const body = await response.json();
                const allItems: any[] = body.items || [];
                // more advanced filter parsing: support comma-separated tokens, field:value, negation (-term), quoted phrases
                const ff = (deletePayload.filterField || 'all');
                const parsePredicate = (filterStr: string) => {
                    const tokens: string[] = [];
                    // simple tokenizer: split by comma, then trim
                    for (const part of filterStr.split(',')) {
                        const t = part.trim();
                        if (!t) continue;
                        tokens.push(t);
                    }
                    return (p: any) => {
                        if (tokens.length === 0) return true;
                        // token matching: all tokens must match (AND across tokens)
                        return tokens.every((tok) => {
                            let negate = false;
                            let token = tok;
                            if (token.startsWith('-')) {
                                negate = true;
                                token = token.slice(1);
                            }
                            // field:value
                            const colonIdx = token.indexOf(':');
                            let field = 'any';
                            let value = token;
                            if (colonIdx > 0) {
                                field = token.slice(0, colonIdx).toLowerCase();
                                value = token.slice(colonIdx + 1);
                            }
                            const valLower = value.replace(/^"(.*)"$/, '$1').toLowerCase();
                            const matchField = (fval: any) => ('' + (fval || '')).toLowerCase().includes(valLower);
                            let matched = false;
                            if (field === 'name') matched = matchField(p.name);
                            else if (field === 'content') matched = matchField(p.content);
                            else if (field === 'id') matched = matchField(p.id);
                            else {
                                matched = matchField(p.name) || matchField(p.content) || matchField(p.id);
                            }
                            return negate ? !matched : matched;
                        });
                    };
                };
                const predicate = parsePredicate(q || '');
                const matched = allItems.filter((p) => {
                    if (!q) return true;
                    return predicate(p);
                });
                if (!mounted) return;
                setPreviewItems(matched);
                setDeletePayload((p: any) => ({ ...p, previewCount: matched.length }));
            } catch (err) {
                if (mounted) addNotification('Preview failed.');
            } finally {
                if (mounted) setPreviewLoading(false);
            }
        };
        // debounce 300ms
        timer = window.setTimeout(doPreview, 300);
        return () => {
            mounted = false;
            if (timer) clearTimeout(timer);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [deletePayload?.filter, deletePayload?.filterField, showDeleteModal, confirmStage]);

    interface Paste {
        id: string;
        name: string;
        content: string;
        createdAt: string;
        permanent: boolean; // Asegúrate de que este campo esté definido como boolean
    }

    const handleDeletePaste = async (id: string): Promise<void> => {
        const response = await fetch(`/api/paste/${id}`, { method: 'DELETE' });
        if (response.ok) {
            setPastes(pastes.filter((paste) => paste.id !== id));
            addNotification('Paste deleted successfully.');
            try {
                const { postMessage } = await import('../utils/broadcast');
                postMessage({ type: 'paste_deleted', id });
            } catch (err) {}
        } else {
            addNotification('Failed to delete paste.');
        }
    };

    const toggleSelect = (id: string) => {
        setSelectedIds((prev) => {
            const copy = new Set(prev);
            if (copy.has(id)) copy.delete(id);
            else copy.add(id);
            return copy;
        });
    };

    const selectAllFiltered = (checked: boolean) => {
        if (checked) {
            setSelectedIds(new Set(filteredPastes.map((p) => p.id)));
        } else {
            setSelectedIds(new Set());
        }
    };

    const openDeleteModal = (payload: any) => {
        setDeletePayload(payload);
        setConfirmStage(1);
        setShowDeleteModal(true);
    };

    const closeDeleteModal = () => {
        setShowDeleteModal(false);
        setDeletePayload(null);
        setConfirmStage(0);
    };

    const performBulkDelete = async () => {
        if (!deletePayload) return;
        const body: any = {};
        if (deletePayload.mode === 'selected') {
            body.ids = Array.from(selectedIds);
        } else if (deletePayload.mode === 'filtered') {
            body.filter = deletePayload.filter || '';
            if (deletePayload.filterField) body.filterField = deletePayload.filterField;
            if (deletePayload.filterRules) body.filterRules = deletePayload.filterRules;
            if (deletePayload.matchMode) body.matchMode = deletePayload.matchMode;
            body.type = 'all';
        } else if (deletePayload.mode === 'permanent' || deletePayload.mode === 'temporary' || deletePayload.mode === 'all') {
            body.type = deletePayload.mode === 'temporary' ? 'temporary' : deletePayload.mode;
        }
        try {
            const res = await fetch('/api/pastes', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });
            if (res.ok) {
                const data = await res.json();
                // remove deleted ids locally if provided, otherwise refresh
                if (data.ids && Array.isArray(data.ids)) {
                    const deletedIds: string[] = data.ids;
                    setPastes((prev) => prev.filter((p) => !deletedIds.includes(p.id)));
                    setSelectedIds((prev) => {
                        const copy = new Set(prev);
                        for (const id of deletedIds) copy.delete(id);
                        return copy;
                    });
                } else {
                    // fallback: refetch
                    await fetchPastes(true);
                }
                addNotification(`Deleted ${data.deleted || 0} pastes.`);
                // broadcast local change as well
                try {
                    const { postMessage } = await import('../utils/broadcast');
                    if (data.ids && Array.isArray(data.ids)) {
                        postMessage({ type: 'pastes_bulk_deleted', ids: data.ids });
                    } else {
                        postMessage({ type: 'pastes_bulk_deleted', ids: [] });
                    }
                } catch (err) {}
            } else {
                addNotification('Failed to delete pastes.');
            }
        } catch (err) {
            addNotification('Error deleting pastes.');
        } finally {
            closeDeleteModal();
        }
    };

    const openRenameModal = (paste: Paste) => {
        setRenameTargetId(paste.id);
        setRenameValue(paste.name || '');
        setShowRenameModal(true);
    };

    const handleCancelRename = () => {
        setShowRenameModal(false);
        setRenameTargetId(null);
        setRenameValue('');
    };

    const handleSaveRename = async () => {
        if (!renameTargetId) return;
        const response = await fetch(`/api/paste/${renameTargetId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: renameValue }),
        });
        if (response.ok) {
            setPastes((prev) => prev.map((p) => (p.id === renameTargetId ? { ...p, name: renameValue } : p)));
            addNotification('Name updated successfully.');
            handleCancelRename();
            try {
                const { postMessage } = await import('../utils/broadcast');
                postMessage({ type: 'paste_renamed', id: renameTargetId, name: renameValue });
            } catch (err) {}
        } else {
            addNotification('Failed to update name.');
        }
    };

    const handleClonePaste = (id: string): void => {
        router.push(`/clone/${id}`);
    };

    const handleCopyToClipboard = (text: string, customMessage?: string) => {
        if (typeof navigator !== 'undefined' && navigator.clipboard) {
            navigator.clipboard.writeText(text)
                .then(() => {
                    addNotification(customMessage || 'Texto copiado al portapapeles'); // Pasa solo el mensaje como string
                })
                .catch(() => {
                    fallbackCopyToClipboard(text, customMessage);
                });
        } else {
            fallbackCopyToClipboard(text, customMessage);
        }
    };

    const fallbackCopyToClipboard = (text: string, customMessage?: string) => {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.opacity = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            document.execCommand('copy');
            addNotification(customMessage || 'UUID copied to clipboard'); // Pasa solo el mensaje como string
        } catch (err) {
            addNotification('Failed to copy UUID to clipboard');
        } finally {
            document.body.removeChild(textarea);
        }
    };

    const handleLogout = () => {
        localStorage.removeItem('authToken'); // Elimina el token de autenticación
        document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;'; // Limpia la cookie
        router.push('/login'); // Redirige al login
    };

    if (!mounted) {
        return null;
    }

    return (
        <div className="dashboard-container">
            <div className="dashboard-header">
                <button
                    onClick={handleLogout}
                    className="logout-button"
                    style={{
                        position: 'absolute',
                        top: '10px',
                        right: '10px',
                        backgroundColor: '#ff4d4f',
                        color: '#fff',
                        border: 'none',
                        borderRadius: '5px',
                        padding: '8px 15px',
                        cursor: 'pointer',
                        transition: 'background-color 0.3s',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#d9363e')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#ff4d4f')}
                >
                    <FiLogOut style={{ marginRight: '5px' }} />
                    Logout
                </button>
            </div>
            {/* Buttons moved inside the card under the "Pastes" title */}
            {/* Campo de búsqueda */}
            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    placeholder="Search..."
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    style={{
                        width: '300px', // Ancho reducido
                        padding: '8px',
                        borderRadius: '5px',
                        border: '1px solid #ccc',
                    }}
                />
            </div>
            {/* Contadores de pastes */}
            <div style={{ display: 'flex', gap: '20px', marginBottom: '20px' }}>
                <div
                    style={{
                        padding: '12px 18px',
                        borderRadius: '8px',
                        backgroundColor: '#202224',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        minWidth: '140px',
                        textAlign: 'center',
                    }}
                >
                    <div style={{ fontSize: '13px', color: '#666' }}>Total</div>
                    <div style={{ fontSize: '22px', fontWeight: 700 }}>{total || pastes.length}</div>
                </div>
                <div
                    style={{
                        padding: '12px 18px',
                        borderRadius: '8px',
                        backgroundColor: '#202224',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        minWidth: '140px',
                        textAlign: 'center',
                    }}
                >
                    <div style={{ fontSize: '13px', color: '#666' }}>Permanent</div>
                    <div style={{ fontSize: '22px', fontWeight: 700 }}>{pastes.filter((p) => p.permanent).length}</div>
                </div>
                <div
                    style={{
                        padding: '12px 18px',
                        borderRadius: '8px',
                        backgroundColor: '#202224',
                        boxShadow: '0 1px 3px rgba(0,0,0,0.08)',
                        minWidth: '140px',
                        textAlign: 'center',
                    }}
                >
                    <div style={{ fontSize: '13px', color: '#666' }}>Temporary</div>
                    <div style={{ fontSize: '22px', fontWeight: 700 }}>{pastes.filter((p) => !p.permanent).length}</div>
                </div>
            </div>
            {/* Main content */}
            <div className="dashboard-content">
                <div className="card">
                    <h1 className="card-title">Pastes</h1>
                    <div style={{ display: 'flex', gap: 10, marginTop: 12, marginBottom: 8 }}>
                        <button
                            onClick={() => openDeleteModal({ mode: 'all' })}
                            style={{ backgroundColor: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                        >
                            Delete All
                        </button>
                        <button
                            onClick={() => openDeleteModal({ mode: 'permanent' })}
                            style={{ backgroundColor: '#fa8c16', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                        >
                            Delete Permanent
                        </button>
                        <button
                            onClick={() => openDeleteModal({ mode: 'temporary' })}
                            style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                        >
                            Delete Temporary
                        </button>
                        <button
                            onClick={() => openDeleteModal({ mode: 'filtered', filter: searchTerm })}
                            style={{ backgroundColor: '#555', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                        >
                            Delete Filtered
                        </button>
                        <button
                            onClick={() => openDeleteModal({ mode: 'selected' })}
                            disabled={selectedIds.size === 0}
                            style={{
                                backgroundColor: selectedIds.size === 0 ? '#333' : '#722ed1',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 6,
                                padding: '8px 12px',
                                cursor: selectedIds.size === 0 ? 'not-allowed' : 'pointer',
                            }}
                        >
                            Delete Selected ({selectedIds.size})
                        </button>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: '0.6fr 2fr 3fr 1fr 3fr', gap: 8, padding: '8px 12px', borderBottom: '1px solid #222', fontWeight: 700, alignItems: 'center' }}>
                        <div>
                            <input
                                type="checkbox"
                                onChange={(e) => selectAllFiltered(e.target.checked)}
                                checked={filteredPastes.length > 0 && selectedIds.size === filteredPastes.length}
                                aria-label="Select all filtered"
                            />
                        </div>
                        <div>Name</div>
                        <div>UUID</div>
                        <div>Permanent</div>
                        <div>Actions</div>
                    </div>
                    <div>
                        {filteredPastes.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: '#999' }}>No pastes to show</div>
                        ) : (
                            filteredPastes.map((paste) => (
                                <div key={paste.id} style={{ display: 'grid', gridTemplateColumns: '0.6fr 2fr 3fr 1fr 3fr', gap: 8, alignItems: 'center', padding: '8px 12px', borderBottom: '1px solid #111' }}>
                                    <div>
                                        <input type="checkbox" checked={selectedIds.has(paste.id)} onChange={() => toggleSelect(paste.id)} />
                                    </div>
                                    <div>{paste.name}</div>
                                    <div onClick={() => handleCopyToClipboard(paste.id)} style={{ cursor: 'pointer', color: 'blue', textDecoration: 'underline' }}>
                                        {paste.id}
                                    </div>
                                    <div>{paste.permanent ? 'Yes' : 'No'}</div>
                                    <div style={{ display: 'flex', gap: '10px' }}>
                                        <button className="button preview-button" onClick={() => window.open(`/${paste.id}`, '_blank')} style={{ backgroundColor: '#52c41a', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' }}>
                                            <FaEye /> Preview
                                        </button>
                                        <button className="button copy-url-button" onClick={() => handleCopyToClipboard(`${window.location.origin}/${paste.id}`, 'URL copied to clipboard')} style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' }}>
                                            <FaClipboard /> Copy URL
                                        </button>
                                        <button className="button clone-button" onClick={() => handleClonePaste(paste.id)} style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' }}>
                                            <FaClipboard /> Clone
                                        </button>
                                        <button className="button rename-button" onClick={() => openRenameModal(paste)} style={{ backgroundColor: '#fa8c16', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' }}>
                                            Rename
                                        </button>
                                        <button className="button delete-button" onClick={() => handleDeletePaste(paste.id)} style={{ backgroundColor: '#ff4d4f', color: '#fff', border: 'none', borderRadius: '5px', padding: '8px 15px', cursor: 'pointer' }}>
                                            <FaTrash /> Delete
                                        </button>
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                    <div ref={sentinelRef} style={{ height: 1 }} />
                    <div style={{ padding: 12, textAlign: 'center' }}>
                        {loading && <div>Loading...</div>}
                        {loadingMore && <div>Loading more...</div>}
                        {!loading && !loadingMore && pastes.length < total && (
                            <button onClick={() => setPage((p) => p + 1)} style={{ padding: '8px 12px' }}>
                                Load more
                            </button>
                        )}
                        {!loading && !loadingMore && pastes.length >= total && <div>All loaded</div>}
                    </div>
                </div>
            </div>
            {showRenameModal && (
                <div
                    onClick={handleCancelRename}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.5)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 2000,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: '#0f0f0f',
                            padding: '20px',
                            borderRadius: '8px',
                            width: '420px',
                            boxShadow: '0 8px 24px rgba(0,0,0,0.6)',
                            color: '#e6e6e6',
                        }}
                    >
                        <h3 style={{ margin: 0, marginBottom: '6px' }}>Rename paste</h3>
                        <p style={{ margin: 0, marginBottom: '10px', fontSize: '13px', color: '#999' }}>
                            Use <code style={{ background: '#2a2a2a', padding: '1px 4px', borderRadius: 4 }}>&lt;br&gt;</code> for line breaks and <code style={{ background: '#2a2a2a', padding: '1px 4px', borderRadius: 4 }}>&lt;hr&gt;</code> for a horizontal line.
                        </p>
                        <input
                            autoFocus
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveRename();
                                if (e.key === 'Escape') handleCancelRename();
                            }}
                            style={{
                                width: '100%',
                                padding: '10px',
                                borderRadius: '6px',
                                border: '1px solid #333',
                                backgroundColor: '#1a1a1a',
                                color: '#fff',
                                marginBottom: '12px',
                            }}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                            <button
                                onClick={handleCancelRename}
                                style={{
                                    backgroundColor: '#3a3a3a',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                }}
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveRename}
                                style={{
                                    backgroundColor: '#1890ff',
                                    color: '#fff',
                                    border: 'none',
                                    borderRadius: '6px',
                                    padding: '8px 12px',
                                    cursor: 'pointer',
                                }}
                            >
                                Save
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {showDeleteModal && deletePayload && (
                <div
                    onClick={closeDeleteModal}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        backgroundColor: 'rgba(0,0,0,0.6)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 3000,
                    }}
                >
                    <div
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            backgroundColor: '#0f0f0f',
                            padding: '24px',
                            borderRadius: '8px',
                            width: '560px',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                            color: '#e6e6e6',
                        }}
                    >
                        <h3 style={{ marginTop: 0 }}>
                            {confirmStage === 1 ? 'Confirm deletion' : 'FINAL CONFIRMATION'}
                        </h3>
                        <p style={{ color: '#bbb' }}>
                            {confirmStage === 1
                                ? `You are about to delete ${deletePayload.mode === 'selected' ? selectedIds.size : deletePayload.mode === 'filtered' ? 'filtered items' : deletePayload.mode} items. This action is irreversible.`
                                : 'This is the final confirmation. Type DELETE to confirm permanently.'}
                        </p>

                        {/* Advanced filter builder for "filtered" mode */}
                        {deletePayload.mode === 'filtered' && confirmStage === 1 && (
                            <div style={{ marginBottom: 12 }}>
                                <div style={{ marginBottom: 8, color: '#ddd', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>Filter builder</div>
                                    <div style={{ color: '#ccc', fontSize: 12 }}>
                                        Match mode:
                                        <select
                                            value={deletePayload.matchMode || 'AND'}
                                            onChange={(e) => setDeletePayload((p: any) => ({ ...p, matchMode: e.target.value }))}
                                            style={{ marginLeft: 6, background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '2px 6px' }}
                                        >
                                            <option value="AND">All rules (AND)</option>
                                            <option value="OR">Any rule (OR)</option>
                                        </select>
                                    </div>
                                </div>

                                {(deletePayload.filterRules || []).map((rule: any, idx: number) => (
                                    <div key={idx} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                                        <select
                                            value={rule.field || 'any'}
                                            onChange={(e) =>
                                                setDeletePayload((p: any) => {
                                                    const rules = [...(p.filterRules || [])];
                                                    rules[idx] = { ...rules[idx], field: e.target.value };
                                                    return { ...p, filterRules: rules };
                                                })
                                            }
                                            style={{ background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '6px' }}
                                        >
                                            <option value="any">Any</option>
                                            <option value="name">Name</option>
                                            <option value="content">Content</option>
                                            <option value="id">ID</option>
                                        </select>
                                        <select
                                            value={rule.op || 'contains'}
                                            onChange={(e) =>
                                                setDeletePayload((p: any) => {
                                                    const rules = [...(p.filterRules || [])];
                                                    rules[idx] = { ...rules[idx], op: e.target.value };
                                                    return { ...p, filterRules: rules };
                                                })
                                            }
                                            style={{ background: '#1a1a1a', color: '#fff', border: '1px solid #333', borderRadius: 4, padding: '6px' }}
                                        >
                                            <option value="contains">Contains</option>
                                            <option value="exact">Exact</option>
                                            <option value="starts">Starts with</option>
                                            <option value="regex">Regex</option>
                                        </select>
                                        <input
                                            value={rule.value || ''}
                                            onChange={(e) =>
                                                setDeletePayload((p: any) => {
                                                    const rules = [...(p.filterRules || [])];
                                                    rules[idx] = { ...rules[idx], value: e.target.value };
                                                    return { ...p, filterRules: rules };
                                                })
                                            }
                                            placeholder='value (use quotes for phrases, prefix "-" to negate)'
                                            style={{ flex: 1, padding: '8px', borderRadius: 6, background: '#1a1a1a', border: '1px solid #333', color: '#fff' }}
                                        />
                                        <label style={{ color: '#ccc', display: 'flex', alignItems: 'center', gap: 6 }}>
                                            <input
                                                type="checkbox"
                                                checked={!!rule.negate}
                                                onChange={(e) =>
                                                    setDeletePayload((p: any) => {
                                                        const rules = [...(p.filterRules || [])];
                                                        rules[idx] = { ...rules[idx], negate: e.target.checked };
                                                        return { ...p, filterRules: rules };
                                                    })
                                                }
                                            />
                                            Not
                                        </label>
                                        <button
                                            onClick={() =>
                                                setDeletePayload((p: any) => {
                                                    const rules = [...(p.filterRules || [])];
                                                    rules.splice(idx, 1);
                                                    return { ...p, filterRules: rules };
                                                })
                                            }
                                            style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 6 }}
                                        >
                                            Remove
                                        </button>
                                    </div>
                                ))}

                                <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
                                    <button
                                        onClick={() =>
                                            setDeletePayload((p: any) => ({
                                                ...p,
                                                filterRules: [...(p.filterRules || []), { field: 'any', op: 'contains', value: '', negate: false }],
                                            }))
                                        }
                                        style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                                    >
                                        Add rule
                                    </button>
                                    <button
                                        onClick={() => setDeletePayload((p: any) => ({ ...p, filterRules: [], previewCount: 0 }))}
                                        style={{ backgroundColor: '#333', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                                    >
                                        Clear rules
                                    </button>
                                </div>

                                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <button
                                        onClick={async () => {
                                            // manual preview trigger: use same client-side logic (will respect rules)
                                            try {
                                                setPreviewLoading(true);
                                                const response = await fetch(`/api/pastes?page=1&limit=1000&force=1`);
                                                if (!response.ok) {
                                                    addNotification('Failed to preview matches.');
                                                    setPreviewLoading(false);
                                                    return;
                                                }
                                                const body = await response.json();
                                                const allItems: any[] = body.items || [];
                                                // apply rules locally (client uses same predicate as preview effect)
                                                const rules = deletePayload.filterRules || [];
                                                const matchMode = deletePayload.matchMode || 'AND';
                                                const predicate = (item: any) => {
                                                    if (!rules || rules.length === 0) return true;
                                                    const evalRule = (r: any) => {
                                                        const val = ('' + (r.value || '')).toLowerCase();
                                                        const fieldVal =
                                                            r.field === 'name' ? (item.name || '') : r.field === 'content' ? (item.content || '') : r.field === 'id' ? (item.id || '') : (item.name || '') + ' ' + (item.content || '') + ' ' + (item.id || '');
                                                        let matched = false;
                                                        const fv = ('' + fieldVal).toLowerCase();
                                                        if (r.op === 'contains') matched = fv.includes(val);
                                                        else if (r.op === 'exact') matched = fv === val;
                                                        else if (r.op === 'starts') matched = fv.startsWith(val);
                                                        else if (r.op === 'regex') {
                                                            try {
                                                                const re = new RegExp(r.value, 'i');
                                                                matched = re.test(fieldVal);
                                                            } catch (e) {
                                                                matched = false;
                                                            }
                                                        }
                                                        return r.negate ? !matched : matched;
                                                    };
                                                };
                                                // reuse debounced preview logic by setting deletePayload.filter to trigger effect
                                                setDeletePayload((p: any) => ({ ...p, previewCount: 0 }));
                                                // trigger preview effect by updating state (it already listens to filterRules)
                                                setPreviewItems(
                                                    allItems.filter((item) => {
                                                        const rules = deletePayload.filterRules || [];
                                                        if (rules.length === 0) return true;
                                                        const results = rules.map((r: any) => {
                                                            const val = ('' + (r.value || '')).toLowerCase();
                                                            const fieldVal =
                                                                r.field === 'name' ? (item.name || '') : r.field === 'content' ? (item.content || '') : r.field === 'id' ? (item.id || '') : (item.name || '') + ' ' + (item.content || '') + ' ' + (item.id || '');
                                                            const fv = ('' + fieldVal).toLowerCase();
                                                            let matched = false;
                                                            if (r.op === 'contains') matched = fv.includes(val);
                                                            else if (r.op === 'exact') matched = fv === val;
                                                            else if (r.op === 'starts') matched = fv.startsWith(val);
                                                            else if (r.op === 'regex') {
                                                                try {
                                                                    const re = new RegExp(r.value, 'i');
                                                                    matched = re.test(fieldVal);
                                                                } catch (e) {
                                                                    matched = false;
                                                                }
                                                            }
                                                            return r.negate ? !matched : matched;
                                                        });
                                                        if ((deletePayload.matchMode || 'AND') === 'AND') return results.every(Boolean);
                                                        return results.some(Boolean);
                                                    })
                                                );
                                                setDeletePayload((p: any) => ({ ...p, previewCount: previewItems.length }));
                                                setShowPreviewList(true);
                                            } catch (err) {
                                                addNotification('Preview failed.');
                                            } finally {
                                                setPreviewLoading(false);
                                            }
                                        }}
                                        style={{ backgroundColor: '#1890ff', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                                    >
                                        Preview matches
                                    </button>
                                    <div style={{ color: '#ccc' }}>
                                        {deletePayload.previewCount != null ? `${deletePayload.previewCount} matches` : 'No preview yet'}
                                    </div>
                                </div>
                            </div>
                        )}

                        {confirmStage === 2 && (
                            <input
                                value={deletePayload.confirmText || ''}
                                onChange={(e) => setDeletePayload((p: any) => ({ ...p, confirmText: e.target.value }))}
                                placeholder="Type DELETE to confirm"
                                style={{ width: '100%', padding: '10px', borderRadius: 6, marginBottom: 12, background: '#1a1a1a', border: '1px solid #333', color: '#fff' }}
                            />
                        )}
                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10 }}>
                            <button
                                onClick={closeDeleteModal}
                                style={{ backgroundColor: '#3a3a3a', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                            >
                                Cancel
                            </button>
                            {confirmStage === 1 ? (
                                <button
                                    onClick={() => setConfirmStage(2)}
                                    style={{ backgroundColor: '#ff4d4f', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                                >
                                    Yes, continue
                                </button>
                            ) : (
                                <button
                                    onClick={() => {
                                        if ((deletePayload.confirmText || '').toUpperCase() === 'DELETE') {
                                            performBulkDelete();
                                        } else {
                                            addNotification('You must type DELETE to confirm.');
                                        }
                                    }}
                                    style={{ backgroundColor: '#d9363e', color: '#fff', border: 'none', borderRadius: 6, padding: '8px 12px', cursor: 'pointer' }}
                                >
                                    Delete permanently
                                </button>
                            )}
                        </div>
                        {/* Preview list */}
                        {showPreviewList && previewItems && (
                            <div style={{ marginTop: 16, maxHeight: 360, overflow: 'auto', borderTop: '1px solid #222', paddingTop: 12 }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                                    <div style={{ fontWeight: 700, color: '#ddd' }}>Preview</div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                        <div style={{ color: '#ccc' }}>Page</div>
                                        <button
                                            onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                                            disabled={previewPage === 1}
                                            style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 6, cursor: previewPage === 1 ? 'not-allowed' : 'pointer' }}
                                        >
                                            Prev
                                        </button>
                                        <div style={{ color: '#ccc' }}>{previewPage}</div>
                                        <button
                                            onClick={() => setPreviewPage((p) => p + 1)}
                                            disabled={previewPage * previewPageSize >= (previewItems?.length || 0)}
                                            style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 8px', borderRadius: 6, cursor: previewPage * previewPageSize >= (previewItems?.length || 0) ? 'not-allowed' : 'pointer' }}
                                        >
                                            Next
                                        </button>
                                        <select value={previewPageSize} onChange={(e) => { setPreviewPageSize(Number(e.target.value)); setPreviewPage(1); }} style={{ background: '#222', color: '#fff', border: '1px solid #333', padding: '6px', borderRadius: 6 }}>
                                            <option value={5}>5</option>
                                            <option value={10}>10</option>
                                            <option value={25}>25</option>
                                            <option value={50}>50</option>
                                        </select>
                                    </div>
                                </div>
                                <div style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr', gap: 8, padding: '6px 8px', fontWeight: 700, borderBottom: '1px solid #222' }}>
                                    <div>Name</div>
                                    <div>UUID</div>
                                    <div>Permanent</div>
                                </div>
                                {previewLoading ? (
                                    <div style={{ padding: 12, color: '#ccc' }}>Loading...</div>
                                ) : previewItems.length === 0 ? (
                                    <div style={{ padding: 12, color: '#999' }}>No matches</div>
                                ) : (
                                    (() => {
                                        const start = (previewPage - 1) * previewPageSize;
                                        const pageItems = previewItems.slice(start, start + previewPageSize);
                                        return pageItems.map((p) => (
                                            <div key={p.id} style={{ display: 'grid', gridTemplateColumns: '2fr 3fr 1fr', gap: 8, alignItems: 'center', padding: '8px 8px', borderBottom: '1px solid #111' }}>
                                                <div>{p.name}</div>
                                                <div style={{ color: 'blue', textDecoration: 'underline', cursor: 'pointer' }} onClick={() => { navigator.clipboard?.writeText(p.id); addNotification('UUID copied'); }}>
                                                    {p.id}
                                                </div>
                                                <div>{String(p.permanent) === 'true' || p.permanent === true ? 'Yes' : 'No'}</div>
                                            </div>
                                        ));
                                    })()
                                )}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
                                    <div style={{ color: '#ccc' }}>{previewItems.length} total</div>
                                    <div>
                                        <button onClick={() => setShowPreviewList(false)} style={{ background: '#333', color: '#fff', border: 'none', padding: '6px 10px', borderRadius: 6 }}>Close preview</button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default Dashboard;

// Server-side protection for the dashboard route using cookies.
export const getServerSideProps: GetServerSideProps = async (context) => {
    const { req } = context;
    const cookieHeader = req.headers.cookie || '';
    const cookies = cookieHeader ? parse(cookieHeader) : {};

    if (!cookies['auth-token']) {
        return {
            redirect: {
                destination: '/login',
                permanent: false,
            },
        };
    }

    return {
        props: {},
    };
};
