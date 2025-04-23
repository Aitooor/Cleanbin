import React, { createContext, useContext, useState, ReactNode, useRef, useEffect } from 'react';

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

export const NotificationProvider: React.FC<NotificationProviderProps> = ({ children }) => {
    const [notifications, setNotifications] = useState<Notification[]>([]);
    const timers = useRef<{ [key: number]: NodeJS.Timeout }>({}); // Referencia para manejar los temporizadores

    const addNotification = (message: string) => {
        const id = Date.now();
        const newNotification: Notification = {
            id,
            message,
            remainingTime: 5000, // 5 segundos por defecto
            startTime: Date.now(),
            paused: false,
        };
        setNotifications((prev) => [...prev, newNotification]);

        // Configura el temporizador para eliminar la notificación
        timers.current[id] = setTimeout(() => {
            removeNotification(id);
        }, 5000);
    };

    const removeNotification = (id: number) => {
        setNotifications((prev) => prev.filter((notification) => notification.id !== id));
        clearTimeout(timers.current[id]);
        delete timers.current[id];
    };

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

    useEffect(() => {
        const updateProgress = () => {
            setNotifications((prev) =>
                prev.map((n) =>
                    n.paused
                        ? n // Si está pausado, no actualiza el tiempo restante
                        : {
                              ...n,
                              remainingTime: Math.max(0, n.remainingTime - 100), // Reduce el tiempo restante cada 100ms
                          }
                )
            );
        };

        const interval = setInterval(updateProgress, 100); // Actualiza cada 100ms para suavizar la barra
        return () => clearInterval(interval); // Limpia el intervalo al desmontar
    }, []);

    return (
        <NotificationContext.Provider value={{ addNotification }}>
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
