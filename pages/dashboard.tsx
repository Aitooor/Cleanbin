import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { useNotification } from '../components/NotificationProvider';
import { FaTrash, FaClipboard, FaEye } from 'react-icons/fa';
import { FiLogOut } from 'react-icons/fi';
import type { GetServerSideProps } from 'next';
import { parse } from 'cookie';

type DashboardProps = {
    onAction?: (id: string) => void;
};

const Dashboard: React.FC<DashboardProps> = ({ onAction }) => {
    const [pastes, setPastes] = useState<Paste[]>([]);
    const [searchTerm, setSearchTerm] = useState(''); // Estado para el término de búsqueda
    const [filteredPastes, setFilteredPastes] = useState<Paste[]>([]); // Estado para los pastes filtrados
    const [notifications, setNotifications] = useState<{ id: number; paused: boolean; remainingTime: number; startTime: number }[]>([]);
    const [mounted, setMounted] = useState(false);
    const router = useRouter();
    const timers = React.useRef<{ [key: number]: NodeJS.Timeout }>({});
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
        const updateProgress = () => {
            setNotifications((prev) =>
                prev.map((n) =>
                    n.paused
                        ? n
                        : {
                              ...n,
                              remainingTime: Math.max(0, n.remainingTime - 100),
                          }
                )
            );
        };

        const interval = setInterval(updateProgress, 100);
        return () => clearInterval(interval);
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

    interface DuplicatePasteResponse {
        id: string;
        content: string;
    }

    const handleDuplicatePaste = async (id: string): Promise<void> => {
        const response = await fetch(`/api/paste/${id}`);
        const paste: Paste = await response.json();
        const duplicateResponse = await fetch('/api/paste', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content: paste.content }),
        });
        if (duplicateResponse.ok) {
            const newPaste: DuplicatePasteResponse = await duplicateResponse.json();
            setPastes([...pastes, { id: newPaste.id, name: paste.name, content: paste.content, createdAt: paste.createdAt, permanent: paste.permanent }]);
        }
    };

    const handleClonePaste = (id: string): void => {
        router.push(`/clone/${id}`);
    };

    const handlePreviewPaste = (id: string): void => {
        router.push(`/${id}`);
    };

    const handleAction = (id: string) => {
        if (onAction) {
            onAction(id);
        }
    };

    const handleMouseEnter = (id: number) => {
        setNotifications((prev) =>
            prev.map((n) =>
                n.id === id
                    ? {
                          ...n,
                          paused: true,
                      }
                    : n
            )
        );
        clearTimeout(timers.current[id]);
    };

    const handleMouseLeave = (id: number) => {
        setNotifications((prev) =>
            prev.map((n) =>
                n.id === id
                    ? {
                          ...n,
                          paused: false,
                          startTime: Date.now(),
                      }
                    : n
            )
        );

        const notification = notifications.find((n) => n.id === id);
        if (notification) {
            timers.current[id] = setTimeout(() => {}, notification.remainingTime);
        }
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
