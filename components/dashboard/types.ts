import type { ReactNode } from 'react';

// Shared shapes for the dashboard pages and components. Kept in one place so
// the API contracts (fields, enums) are declared only once.

export type SessionRole = 'admin' | 'user';

export type DashboardSession = {
    sessionEmail: string;
    sessionRole: SessionRole;
    permanentDeleteLimit: number | null;
};

export type PasteScope = 'all' | 'mine' | 'shared' | 'anonymous' | 'default';

export type Paste = {
    id: string;
    name: string;
    content?: string;
    createdAt: string;
    permanent: boolean;
    owner?: string | null;
    sharedWith?: string[];
    mine?: boolean;
    version?: number;
    updatedAt?: string;
};

export type UserStatus = 'invited' | 'active';

export type DashboardUser = {
    email: string;
    role: SessionRole;
    permanentDeleteLimit: number;
    createdAt: string;
    status: UserStatus;
    totpEnabled: boolean;
    invitePending: boolean;
    hasPasskey: boolean;
    immutable?: boolean;
};

export type PagedResponse<T> = {
    total: number;
    page: number;
    limit: number;
    items: T[];
};

// One signed-in device. `current` marks the session making the request.
export type DashboardSessionInfo = {
    id: string;
    email: string;
    role: SessionRole;
    userAgent: string;
    createdAt: string;
    lastSeenAt: string;
    current: boolean;
};

export type TableColumn<T> = {
    key: string;
    header: ReactNode;
    render: (row: T) => ReactNode;
    align?: 'left' | 'center' | 'right';
    className?: string;
    width?: string;
};

export type PageHeadProps = {
    title: string;
    description?: string;
    actions?: ReactNode;
};
