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

export type PasteFilterField = 'any' | 'name' | 'content' | 'id';

export type PasteFilterOp = 'contains' | 'exact' | 'starts' | 'regex';

export type PasteMatchMode = 'AND' | 'OR';

export type PasteSortField = 'createdAt' | 'name' | 'permanent';

export type PasteSortDir = 'asc' | 'desc';

// Server-side filter rule, mirroring the shape accepted by GET /api/pastes
// (?filterRules=) and DELETE /api/pastes (filterRules).
export type PasteFilterRule = {
    field: PasteFilterField;
    op: PasteFilterOp;
    value: string;
    negate: boolean;
};

// Everything the pastes listing needs to build its request. Kept in one object
// so the listing, the delete preview and the delete call can share it.
export type PasteListQuery = {
    scope: PasteScope;
    query: string;
    filterRules: PasteFilterRule[];
    matchMode: PasteMatchMode;
    sort: PasteSortField | null;
    dir: PasteSortDir;
};

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
