import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, ReactNode } from 'react';

type NotificationContextType = {
    addNotification: (message: string) => void;
};

const NotificationContext = createContext<NotificationContextType | undefined>(undefined);

type NotificationProviderProps = {
    children: ReactNode;
};

type Notification = {
    id: number;
    message: string;
    remainingTime: number; // Tiempo restante en milisegundos
    startTime: number; // Marca de tiempo cuando comenzó la cuenta regresiva
    paused: boolean; // Indica si la notificación está pausada
};

const NOTIFICATION_DURATION = 5000; // 5 segundos por defecto
const PROGRESS_TICK = 100; // Actualiza cada 100ms para suavizar la barra

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const timers = useRef<{ [key: number]: NodeJS.Timeout }>({}); // Referencia para manejar los temporizadores

    // Stable identity so consumers can safely list it in effect deps.
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
            const id = Date.now();
            const newNotification: Notification = {
                id,
                message,
                remainingTime: NOTIFICATION_DURATION,
                startTime: Date.now(),
                paused: false,
            };
            setNotifications((prev) => [...prev, newNotification]);

            // Configura el temporizador para eliminar la notificación
            timers.current[id] = setTimeout(() => {
                removeNotification(id);
            }, NOTIFICATION_DURATION);
        },
        [removeNotification]
    );

    const handleMouseEnter = (id: number) => {
        setNotifications((prev) =>
            prev.map((n) =>
                n.id === id
                    ? {
                          ...n,
                          paused: true, // Marca la notificación como pausada
                      }
                    : n
            )
        );
        clearTimeout(timers.current[id]); // Pausa el temporizador
    };

    const handleMouseLeave = (id: number) => {
        setNotifications((prev) =>
            prev.map((n) =>
                n.id === id
                    ? {
                          ...n,
                          startTime: Date.now(), // Reinicia el tiempo de inicio
                          paused: false, // Marca la notificación como no pausada
                      }
                    : n
            )
        );

        const notification = notifications.find((n) => n.id === id);
        if (notification) {
            // Reinicia el temporizador con el tiempo restante
            timers.current[id] = setTimeout(() => {
                removeNotification(id);
            }, notification.remainingTime);
        }
    };

    // The interval only runs while a notification is actually counting down, so
    // an idle provider never schedules a timer (which used to re-render the whole
    // tree every 100ms). The boolean keeps the effect from restarting on each tick.
    const hasActiveNotification = notifications.some((notification) => !notification.paused && notification.remainingTime > 0);

    useEffect(() => {
        if (!hasActiveNotification) return;

        const updateProgress = () => {
            setNotifications((prev) =>
                prev.map((n) =>
                    n.paused
                        ? n // Si está pausado, no actualiza el tiempo restante
                        : {
                              ...n,
                              remainingTime: Math.max(0, n.remainingTime - PROGRESS_TICK), // Reduce el tiempo restante cada 100ms
                          }
                )
            );
        };

        const interval = setInterval(updateProgress, PROGRESS_TICK);
        return () => clearInterval(interval); // Limpia el intervalo al desmontar o al no quedar notificaciones activas
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
                                width: `${(notification.remainingTime / 5000) * 100}%`, // Calcula el ancho dinámicamente
                                backgroundColor: '#1e88e5',
                                transition: 'width 0.1s linear', // Suaviza la transición
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
