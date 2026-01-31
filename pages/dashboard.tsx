import React, { useState, useEffect } from 'react';
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

    useEffect(() => {
        setMounted(true);
    }, []);

    useEffect(() => {
        const fetchData = async () => {
            const response = await fetch('/api/pastes');
            if (response.ok) {
                const data: Paste[] = await response.json();
                setPastes(data);
                setFilteredPastes(data); // Inicializar los pastes filtrados
            }
        };
        fetchData();
    }, []);

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
        } else {
            addNotification('Failed to delete paste.');
        }
    };

    const openRenameModal = (paste: Paste) => {
        if (!paste.permanent) return;
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
                    <div style={{ fontSize: '22px', fontWeight: 700 }}>{pastes.length}</div>
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
                    <table>
                        <thead>
                            <tr>
                                <th>Name</th>
                                <th>UUID</th>
                                <th>Permanent</th> {/* Nueva columna */}
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredPastes.map((paste) => (
                                <tr key={paste.id}>
                                    <td>{paste.name}</td>
                                    <td
                                        onClick={() => handleCopyToClipboard(paste.id)}
                                        style={{ cursor: 'pointer', color: 'blue', textDecoration: 'underline' }}
                                    >
                                        {paste.id}
                                    </td>
                                    <td>{paste.permanent ? 'Yes' : 'No'}</td> {/* Mostrar correctamente el valor booleano */}
                                    <td>
                                        <div style={{ display: 'flex', gap: '10px' }}>
                                            <button
                                                className="button preview-button"
                                                onClick={() => window.open(`/${paste.id}`, '_blank')}
                                                style={{
                                                    backgroundColor: '#52c41a',
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
                                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#389e0d')}
                                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#52c41a')}
                                            >
                                                <FaEye />
                                                Preview
                                            </button>
                                            <button
                                                className="button copy-url-button"
                                                onClick={() => handleCopyToClipboard(`${window.location.origin}/${paste.id}`, 'URL copied to clipboard')}
                                                style={{
                                                    backgroundColor: '#1890ff',
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
                                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#096dd9')}
                                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#1890ff')}
                                            >
                                                <FaClipboard />
                                                Copy URL
                                            </button>
                                            <button
                                                className="button clone-button"
                                                onClick={() => handleClonePaste(paste.id)}
                                                style={{
                                                    backgroundColor: '#1890ff',
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
                                                onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#096dd9')}
                                                onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#1890ff')}
                                            >
                                                <FaClipboard />
                                                Clone
                                            </button>
                                            {paste.permanent && (
                                                <button
                                                    className="button rename-button"
                                                    onClick={() => openRenameModal(paste)}
                                                    style={{
                                                        backgroundColor: '#fa8c16',
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
                                                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#d97706')}
                                                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = '#fa8c16')}
                                                >
                                                    Renombrar
                                                </button>
                                            )}
                                            <button
                                                className="button delete-button"
                                                onClick={() => handleDeletePaste(paste.id)}
                                                style={{
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
                                                <FaTrash />
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
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
                        <h3 style={{ margin: 0, marginBottom: '10px' }}>Renombrar paste</h3>
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
                                Cancelar
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
                                Guardar
                            </button>
                        </div>
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
