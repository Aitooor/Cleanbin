import React, { useState, useEffect } from 'react';
import { useNotification } from './NotificationProvider';
import { FiSave, FiFilePlus } from 'react-icons/fi'; // Importa iconos modernos
import { parse } from 'cookie';

const Editor = () => {
    const [content, setContent] = useState('');
    const [name, setName] = useState('');
    const [isLoggedIn, setIsLoggedIn] = useState(false);
    // default Temp instead of Permanent when logged in
    const [isPermanent, setIsPermanent] = useState(false);
    const { addNotification } = useNotification();

    useEffect(() => {
        const cookies = parse(document.cookie || '');
        setIsLoggedIn(cookies['auth-token'] === 'true');
    }, []);

    const handleSave = async () => {
        if (isLoggedIn && isPermanent && !name.trim()) {
            addNotification('Please provide a name for the paste.');
            return;
        }

        if (!content) {
            addNotification('Content is empty!');
            return;
        }

        const response = await fetch('/api/paste', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ content, name, permanent: isPermanent }),
        });

        if (response.ok) {
            const data = await response.json();
            const url = `/${data.id}`;
            window.location.href = url; // Redirect to the preview page
        } else {
            const data = await response.json();
            addNotification(data.message || 'Failed to save paste.');
        }
    };

    return (
        <div
            className="editor-container"
            style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                position: 'relative',
            }}
        >
            <input
                type="text"
                placeholder={isLoggedIn && isPermanent ? 'Enter name (required for permanent)' : 'Enter name (optional)'}
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={{
                    marginBottom: '4px',
                    padding: '10px',
                    borderRadius: '4px',
                    border: '1px solid #333',
                    backgroundColor: '#1e1e1e',
                    color: '#e0e0e0',
                    fontFamily: 'monospace',
                }}
            />
            <p className="editor-name-hint">
                In name: use <code>&lt;br&gt;</code> for line breaks and <code>&lt;hr&gt;</code> for a horizontal line.
            </p>
            <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="Write your paste here..."
                className="editor-textarea"
                style={{
                    flex: 1,
                    width: '100%',
                    backgroundColor: '#1e1e1e',
                    color: '#e0e0e0',
                    border: 'none',
                    padding: '10px',
                    fontFamily: 'monospace',
                    resize: 'none',
                    overflowY: 'auto',
                }}
            />
            <div
                className="editor-buttons"
                style={{
                    display: 'flex',
                    gap: '10px',
                    backgroundColor: '#1e1e1e',
                    padding: '5px',
                    borderRadius: '8px',
                }}
            >
                {isLoggedIn && (
                    <button
                        onClick={() => setIsPermanent((p) => !p)}
                        style={{
                            backgroundColor: isPermanent ? '#2d5016' : '#1e1e1e',
                            color: isPermanent ? '#90ee90' : '#888',
                            border: '1px solid #333',
                            borderRadius: '4px',
                            padding: '10px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 11,
                            fontWeight: 600,
                            transition: 'background-color 0.2s ease, color 0.2s ease',
                        }}
                        title={isPermanent ? 'Permanent (click to make temporary)' : 'Temporary (click to make permanent)'}
                    >
                        {isPermanent ? 'Permanent' : 'Temp'}
                    </button>
                )}
                <button
                    onClick={() => setContent('')}
                    disabled={!content}
                    style={{
                        backgroundColor: !content ? '#555' : '#1e1e1e',
                        color: !content ? '#888' : '#e0e0e0',
                        border: '1px solid #333',
                        borderRadius: '4px',
                        padding: '10px',
                        cursor: !content ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.3s ease',
                    }}
                    title="New"
                >
                    <FiFilePlus size={20} />
                </button>
                <button
                    onClick={handleSave}
                    style={{
                        backgroundColor: '#1e1e1e',
                        color: '#e0e0e0',
                        border: '1px solid #333',
                        borderRadius: '4px',
                        padding: '10px',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background-color 0.3s ease',
                    }}
                    title="Save"
                >
                    <FiSave size={20} />
                </button>
            </div>
        </div>
    );
};

export default Editor;