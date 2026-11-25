import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

type NotificationContextType = {
  addNotification: (message: string) => void;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

type Notification = {
  id: number;
  message: string;
  remainingTime: number;
  startTime: number;
  paused: boolean;
};

const NOTIFICATION_DURATION = 5000;
const PROGRESS_TICK = 100;

export const NotificationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const timers = useRef<{ [key: number]: ReturnType<typeof setTimeout> }>({});

  const removeNotification = useCallback((id: number) => {
    setNotifications((prev) => prev.filter((notification) => notification.id !== id));
    const timer = timers.current[id];
    if (timer) {
      clearTimeout(timer);
      delete timers.current[id];
    }
  }, []);

  const addNotification = useCallback(
    (message: string) => {
      const id = Date.now() + Math.random();
      const newNotification: Notification = {
        id,
        message,
        remainingTime: NOTIFICATION_DURATION,
        startTime: Date.now(),
        paused: false,
      };
      setNotifications((prev) => [...prev, newNotification]);

      timers.current[id] = setTimeout(() => {
        removeNotification(id);
      }, NOTIFICATION_DURATION);
    },
    [removeNotification]
  );

  const handleMouseEnter = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, paused: true } : n))
    );
    clearTimeout(timers.current[id]);
  };

  const handleMouseLeave = (id: number) => {
    setNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, startTime: Date.now(), paused: false } : n))
    );

    const notification = notifications.find((n) => n.id === id);
    if (notification) {
      timers.current[id] = setTimeout(() => {
        removeNotification(id);
      }, notification.remainingTime);
    }
  };

  const hasActiveNotification = notifications.some((n) => !n.paused && n.remainingTime > 0);

  useEffect(() => {
    if (!hasActiveNotification) return;

    const updateProgress = () => {
      setNotifications((prev) =>
        prev.map((n) =>
          n.paused ? n : { ...n, remainingTime: Math.max(0, n.remainingTime - PROGRESS_TICK) }
        )
      );
    };

    const interval = setInterval(updateProgress, PROGRESS_TICK);
    return () => clearInterval(interval);
  }, [hasActiveNotification]);

  const contextValue = useMemo(() => ({ addNotification }), [addNotification]);

  return (
    <NotificationContext.Provider value={contextValue}>
      {children}
      <div
        style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
          zIndex: 1000,
        }}
      >
        {notifications.map((notification) => (
          <div
            key={notification.id}
            onMouseEnter={() => handleMouseEnter(notification.id)}
            onMouseLeave={() => handleMouseLeave(notification.id)}
            style={{
              position: 'relative',
              backgroundColor: '#1e1e1e',
              color: '#e0e0e0',
              padding: '10px 15px',
              borderRadius: '4px',
              boxShadow: '0 4px 6px rgba(0, 0, 0, 0.5)',
              overflow: 'hidden',
            }}
          >
            {notification.message}
            <div
              style={{
                position: 'absolute',
                bottom: 0,
                left: 0,
                height: '4px',
                width: `${(notification.remainingTime / NOTIFICATION_DURATION) * 100}%`,
                backgroundColor: '#1e88e5',
                transition: 'width 0.1s linear',
              }}
            />
          </div>
        ))}
      </div>
    </NotificationContext.Provider>
  );
};

export const useNotification = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotification must be used within a NotificationProvider');
  }
  return context;
};
