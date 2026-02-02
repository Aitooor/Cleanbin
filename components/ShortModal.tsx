import React from 'react';

interface ShortModalProps {
    showShortModal: boolean;
    shortName: string;
    shortContent: string;
    shortPermanent: boolean;
    shortCreating: boolean;
    setShortName: React.Dispatch<React.SetStateAction<string>>;
    setShortContent: React.Dispatch<React.SetStateAction<string>>;
    setShortPermanent: React.Dispatch<React.SetStateAction<boolean>>;
    setShowShortModal: React.Dispatch<React.SetStateAction<boolean>>;
    handleCreateShort: () => void;
    handleCancelShort: () => void;
}

const ShortModal: React.FC<ShortModalProps> = ({
    showShortModal,
    shortName,
    shortContent,
    shortPermanent,
    shortCreating,
    setShortName,
    setShortContent,
    setShortPermanent,
    setShowShortModal,
    handleCreateShort,
    handleCancelShort,
}) => {
    if (!showShortModal) return null;

    return (
        <div
            onClick={handleCancelShort}
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
                <h3 style={{ margin: 0, marginBottom: '16px' }}>Quick Create Paste</h3>
                
                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#ccc' }}>
                        Name (optional)
                    </label>
                    <input
                        value={shortName}
                        onChange={(e) => setShortName(e.target.value)}
                        placeholder="Enter paste name..."
                        style={{
                            width: '100%',
                            padding: '8px',
                            borderRadius: '4px',
                            border: '1px solid #333',
                            backgroundColor: '#1a1a1a',
                            color: '#fff',
                            fontSize: '14px',
                        }}
                    />
                </div>

                <div style={{ marginBottom: '12px' }}>
                    <label style={{ display: 'block', marginBottom: '4px', fontSize: '13px', color: '#ccc' }}>
                        Content *
                    </label>
                    <textarea
                        value={shortContent}
                        onChange={(e) => setShortContent(e.target.value)}
                        placeholder="Enter paste content..."
                        rows={6}
                        style={{
                            width: '100%',
                            padding: '8px',
                            borderRadius: '4px',
                            border: '1px solid #333',
                            backgroundColor: '#1a1a1a',
                            color: '#fff',
                            fontSize: '14px',
                            resize: 'vertical',
                            fontFamily: 'monospace',
                        }}
                    />
                </div>

                <div style={{ marginBottom: '16px' }}>
                    <label style={{ display: 'flex', alignItems: 'center', fontSize: '13px', color: '#ccc' }}>
                        <input
                            type="checkbox"
                            checked={shortPermanent}
                            onChange={(e) => setShortPermanent(e.target.checked)}
                            style={{ marginRight: '8px' }}
                        />
                        Make permanent (won't auto-delete)
                    </label>
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                    <button
                        onClick={handleCancelShort}
                        style={{
                            backgroundColor: '#3a3a3a',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            cursor: 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleCreateShort}
                        disabled={!shortContent.trim() || shortCreating}
                        style={{
                            backgroundColor: shortCreating ? '#666' : '#1e88e5',
                            color: '#fff',
                            border: 'none',
                            borderRadius: '4px',
                            padding: '8px 16px',
                            cursor: shortCreating ? 'not-allowed' : 'pointer',
                            fontSize: '14px',
                        }}
                    >
                        {shortCreating ? 'Creating...' : 'Create'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export default ShortModal;
