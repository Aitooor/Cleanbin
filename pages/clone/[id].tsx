import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { FiSave, FiX } from 'react-icons/fi'; // Import icons
import hljs from 'highlight.js/lib/core';
import 'highlight.js/styles/github-dark.css'; // Match the theme with the index page
import { useNotification } from '../../components/NotificationProvider'; // Import NotificationProvider

const ClonePage = () => {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const router = useRouter();
    const { id } = router.query;
    const codeRef = useRef<HTMLElement>(null);
    const { addNotification } = useNotification(); // Use notification hook

    useEffect(() => {
        if (typeof id === 'string') {
            setLoading(true);
            fetch(`/api/paste?id=${id}`)
                .then((response) => response.json())
                .then((data) => setContent(data.content || ''))
                .catch(() => setContent('Failed to load paste.'))
                .finally(() => setLoading(false));
        }
    }, [id]);

    useEffect(() => {
        if (codeRef.current) {
            hljs.highlightElement(codeRef.current);
        }
    }, [content]);

    const handleSave = () => {
        fetch('/api/paste', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ content }),
        })
            .then((response) => {
                if (response.ok) {
                    response.json().then((data) => {
                        addNotification('Paste saved successfully!'); // Show success notification
                        router.push(`/${data.id}`); // Redirect to the new paste's path
                    });
                } else {
                    addNotification('Failed to save paste.'); // Show failure notification
                }
            })
            .catch(() => addNotification('Failed to save paste.')); // Show failure notification
    };

    const handleCancel = () => {
        router.push('/dashboard'); // Redirect to the dashboard
    };

    return (
        <div
            style={{
                height: '100vh',
                width: '100vw',
                background: '#1e1e1e',
                margin: 0,
                padding: 0,
                display: 'flex',
                flexDirection: 'column',
            }}
        >
            <div
                style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    alignItems: 'center',
                    padding: '10px 20px',
                    background: '#121212',
                    boxShadow: '0 2px 4px rgba(0, 0, 0, 0.2)',
                }}
            >
                <button
                    onClick={handleSave}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#1e88e5',
                        cursor: 'pointer',
                        fontSize: '20px',
                        marginRight: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px',
                        borderRadius: '50%',
                        transition: 'background-color 0.3s ease',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#1e1e1e')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <FiSave />
                </button>
                <button
                    onClick={handleCancel}
                    style={{
                        background: 'none',
                        border: 'none',
                        color: '#ff4d4f',
                        cursor: 'pointer',
                        fontSize: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '8px',
                        borderRadius: '50%',
                        transition: 'background-color 0.3s ease',
                    }}
                    onMouseOver={(e) => (e.currentTarget.style.backgroundColor = '#1e1e1e')}
                    onMouseOut={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                    <FiX />
                </button>
            </div>
            <div
                style={{
                    flex: 1,
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'stretch',
                    overflow: 'hidden',
                }}
            >
                <textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)} // Update content on edit
                    style={{
                        width: '100vw',
                        height: 'calc(100vh - 40px)',
                        margin: 0,
                        padding: '18px 8vw',
                        fontSize: 'clamp(11px, 2vw, 15px)',
                        lineHeight: 1.8,
                        fontFamily: 'Fira Mono, Menlo, Monaco, Consolas, monospace',
                        color: '#e0e0e0',
                        background: '#1e1e1e',
                        border: 'none',
                        outline: 'none',
                        resize: 'none',
                        overflow: 'auto',
                        boxSizing: 'border-box',
                    }}
                />
            </div>
        </div>
    );
};

export default ClonePage;
