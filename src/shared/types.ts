export type SessionRole = 'admin' | 'user';
export type UserRole = SessionRole;
export type UserStatus = 'invited' | 'active';

export type PasteScope = 'all' | 'mine' | 'shared' | 'anonymous' | 'default';
export type PasteFilterField = 'any' | 'name' | 'content' | 'id' | 'owner';
export type PasteFilterOp = 'contains' | 'exact' | 'starts' | 'regex';
export type PasteMatchMode = 'AND' | 'OR';
export type PasteSortField = 'createdAt' | 'name' | 'permanent';
export type PasteSortDir = 'asc' | 'desc';

export interface PasteFilterRule {
  field: PasteFilterField;
  op: PasteFilterOp;
  value: string;
  negate: boolean;
}

export interface PasteListQuery {
  scope: PasteScope;
  query: string;
  filterRules: PasteFilterRule[];
  matchMode: PasteMatchMode;
  sort: PasteSortField | null;
  dir: PasteSortDir;
}

export interface PasteRecord {
  id: string;
  content: string;
  name: string;
  permanent: boolean;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  owner: string | null;
  sharedWith: string[];
  version: number;
}

export interface ListedPaste {
  id: string;
  name: string;
  content?: string;
  permanent: boolean;
  createdAt: string;
  updatedAt?: string;
  expiresAt?: string | null;
  owner?: string | null;
  sharedWith?: string[];
  mine?: boolean;
  canEdit?: boolean;
  version?: number;
}

export interface PagedResponse<T> {
  total: number;
  page: number;
  limit: number;
  items: T[];
  truncated?: boolean;
}

export interface DashboardSession {
  sessionEmail: string;
  sessionRole: SessionRole;
  permanentDeleteLimit: number | null;
}

export interface DashboardUser {
  email: string;
  role: SessionRole;
  permanentDeleteLimit: number;
  createdAt: string;
  status: UserStatus;
  totpEnabled: boolean;
  invitePending: boolean;
  hasPasskey: boolean;
  immutable?: boolean;
}

export interface DashboardSessionInfo {
  id: string;
  email: string;
  role: SessionRole;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
}
