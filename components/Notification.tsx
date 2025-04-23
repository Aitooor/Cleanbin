import React, { useEffect, useState, useRef } from 'react';

interface NotificationProps {
    id: string;
    message: string;
    duration?: number; // Duration in milliseconds
    onRemove: (id: string) => void;
}

const Notification = ({ id, message, duration = 5000, onRemove }: NotificationProps) => {
    const [hovered, setHovered] = useState(false);
    const [progress, setProgress] = useState(100);
    const startTimeRef = useRef(Date.now());
    const remainingTimeRef = useRef(duration);

    useEffect(() => {
        let interval: NodeJS.Timeout | null = null;

        const updateProgress = () => {
            const elapsed = Date.now() - startTimeRef.current;
            const percentage = Math.max(0, (remainingTimeRef.current - elapsed) / duration * 100);
            setProgress(percentage);

            if (percentage === 0) {
                clearInterval(interval!);
                onRemove(id);
            }
        };

        if (!hovered) {
            startTimeRef.current = Date.now();
            interval = setInterval(updateProgress, 50);
        }

        return () => {
            if (interval) clearInterval(interval);
        };
    }, [hovered, duration, id, onRemove]);

    const handleMouseEnter = () => {
        setHovered(true);
        const elapsed = Date.now() - startTimeRef.current;
        remainingTimeRef.current -= elapsed;
    };

    const handleMouseLeave = () => {
        setHovered(false);
    };

    const handleClick = () => {
        onRemove(id); // Remove the notification immediately on click
    };

    return (
        <div
            className="notification"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onClick={handleClick}
            style={{
                backgroundColor: '#1e1e1e',
                color: '#e0e0e0',
                padding: '10px 15px',
                borderRadius: '4px',
                boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)',
                marginBottom: '10px',
                position: 'relative',
                cursor: 'pointer',
            }}
        >
            {message}
            <div
                style={{
                    position: 'absolute',
                    bottom: 0,
                    left: 0,
                    height: '4px',
                    width: `${progress}%`,
                    backgroundColor: '#1e88e5',
                    transition: 'width 0.05s linear',
                }}
            />
        </div>
    );
};

export default Notification;
