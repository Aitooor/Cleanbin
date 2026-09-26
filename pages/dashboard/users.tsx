import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { GetServerSideProps } from 'next';
import {
    FiClipboard,
    FiEdit2,
    FiKey,
    FiMail,
    FiRefreshCw,
    FiSave,
    FiShield,
    FiTrash2,
    FiUserPlus,
    FiUsers,
} from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import {
    Badge,
    Button,
    Callout,
    Card,
    EmptyState,
    IconButton,
    Input,
    LoadingState,
    Modal,
    PageHeader,
    Select,
    Table,
} from '../../components/dashboard/ui';
import type { DashboardSession, DashboardUser, SessionRole, TableColumn } from '../../components/dashboard/types';
import { formatDate } from '../../components/dashboard/format';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
import { useNotification } from '../../components/NotificationProvider';

type CreateUserForm = {
    email: string;
    role: SessionRole;
    permanentDeleteLimit: string;
};

type EditUserForm = {
    role: SessionRole;
    permanentDeleteLimit: string;
    password: string;
};

const EMPTY_CREATE_FORM: CreateUserForm = { email: '', role: 'user', permanentDeleteLimit: '2' };

type SecurityActionProps = {
    title: string;
    description: string;
    actionLabel: string;
    tone?: 'secondary' | 'warning' | 'danger';
    icon: ReactNode;
    disabled?: boolean;
    onAction: () => void;
};

// Row with a short explanation next to its action, so every security button
// states exactly what it does before it is pressed.
function SecurityAction({ title, description, actionLabel, tone = 'secondary', icon, disabled, onAction }: SecurityActionProps) {
    return (
        <div className="dash-security-action">
            <div className="dash-security-action-copy">
                <span className="dash-security-action-title">{title}</span>
                <p className="dash-note">{description}</p>
            </div>
            <Button variant={tone} size="sm" icon={icon} disabled={disabled} onClick={onAction}>
                {actionLabel}
            </Button>
        </div>
    );
}

export default function UsersPage({ sessionEmail, sessionRole, permanentDeleteLimit }: DashboardSession) {
    const { addNotification } = useNotification();
    const isAdmin = sessionRole === 'admin';

    const [users, setUsers] = useState<DashboardUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [form, setForm] = useState<CreateUserForm>(EMPTY_CREATE_FORM);
    const [busy, setBusy] = useState(false);
    const [setupUrl, setSetupUrl] = useState<string | null>(null);

    const [editTarget, setEditTarget] = useState<DashboardUser | null>(null);
    const [editForm, setEditForm] = useState<EditUserForm>({ role: 'user', permanentDeleteLimit: '0', password: '' });
    const [editBusy, setEditBusy] = useState(false);
    const [resetUrl, setResetUrl] = useState<string | null>(null);

    const fetchUsers = useCallback(async (): Promise<DashboardUser[]> => {
        if (!isAdmin) {
            setLoading(false);
            return [];
        }
        setLoading(true);
        try {
            const response = await fetch('/api/users');
            if (response.ok) {
                const data: DashboardUser[] = await response.json();
                setUsers(data);
                return data;
            }
            if (response.status === 403) addNotification('Admin access is required to manage users.');
        } catch {
            addNotification('Failed to load users.');
        } finally {
            setLoading(false);
        }
        return [];
    }, [isAdmin, addNotification]);

    // Keep the open edit modal in sync with the freshly loaded list.
    const refreshEditTarget = useCallback((list: DashboardUser[]) => {
        setEditTarget((current) => (current ? list.find((user) => user.email === current.email) ?? current : current));
    }, []);

    useEffect(() => {
        void fetchUsers();
    }, [fetchUsers]);

    const handleCreate = async () => {
        if (busy) return;
        const limit = Number(form.permanentDeleteLimit);
        if (!Number.isInteger(limit) || limit < 0) {
            addNotification('Limit must be an integer greater than or equal to 0.');
            return;
        }
        if (!/\S+@\S+\.\S+/.test(form.email.trim())) {
            addNotification('Please enter a valid email.');
            return;
        }

        setBusy(true);
        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: form.email.trim(), role: form.role, permanentDeleteLimit: limit }),
            });
            if (response.status === 201) {
                const data = await response.json().catch(() => ({}));
                setForm(EMPTY_CREATE_FORM);
                if (data.setupUrl) {
                    setSetupUrl(data.setupUrl);
                    addNotification('Invitation created, but the email could not be sent. Copy the setup link.');
                } else {
                    setSetupUrl(null);
                    addNotification('Invitation sent.');
                }
                await fetchUsers();
            } else {
                const data = await response.json().catch(() => ({}));
                addNotification(data.message || 'Failed to create user.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleEdit = (user: DashboardUser) => {
        setResetUrl(null);
        setEditTarget(user);
        setEditForm({ role: user.role, permanentDeleteLimit: String(user.permanentDeleteLimit), password: '' });
    };

    const handleSaveEdit = async () => {
        if (!editTarget || editBusy) return;
        const limit = Number(editForm.permanentDeleteLimit);
        if (!Number.isInteger(limit) || limit < 0) {
            addNotification('Limit must be an integer greater than or equal to 0.');
            return;
        }
        if (editForm.password && editForm.password.length < 8) {
            addNotification('Password must be at least 8 characters.');
            return;
        }

        const patch: Record<string, unknown> = { role: editForm.role, permanentDeleteLimit: limit };
        if (editForm.password) patch.password = editForm.password;

        setEditBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(editTarget.email)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(patch),
            });
            if (response.ok) {
                addNotification('User updated.');
                setEditTarget(null);
                await fetchUsers();
            } else {
                const data = await response.json().catch(() => ({}));
                addNotification(data.message || 'Failed to update user.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setEditBusy(false);
        }
    };

    const handleResendInvite = async (user: DashboardUser) => {
        if (busy) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'resend-invite' }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                if (data.setupUrl) {
                    setSetupUrl(data.setupUrl);
                    addNotification('Invitation renewed, but the email could not be sent. Copy the setup link.');
                } else {
                    setSetupUrl(null);
                    addNotification('Invitation sent.');
                }
            } else {
                addNotification(data.message || 'Failed to resend the invitation.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleResetTotp = async (user: DashboardUser) => {
        if (busy) return;
        if (!window.confirm(`Reset two-factor authentication for ${user.email}? They will set it up again on the next login.`)) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset-2fa' }),
            });
            if (response.ok) {
                addNotification('Two-factor authentication reset.');
                refreshEditTarget(await fetchUsers());
            } else {
                const data = await response.json().catch(() => ({}));
                addNotification(data.message || 'Failed to reset two-factor authentication.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleRemovePasskey = async (user: DashboardUser) => {
        if (busy) return;
        if (!window.confirm(`Remove the passkey for ${user.email}? Password sign in will work again.`)) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'remove-passkey' }),
            });
            if (response.ok) {
                addNotification('Passkey removed. Password sign in is enabled again.');
                refreshEditTarget(await fetchUsers());
            } else {
                const data = await response.json().catch(() => ({}));
                addNotification(data.message || 'Failed to remove the passkey.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleSendPasswordReset = async (user: DashboardUser) => {
        if (busy) return;
        if (
            !window.confirm(
                `Send a password reset to ${user.email}? This disables their 2FA and passkey and emails a setup link.`
            )
        ) {
            return;
        }
        setBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(user.email)}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'reset-password' }),
            });
            const data = await response.json().catch(() => ({}));
            if (response.ok) {
                refreshEditTarget(await fetchUsers());
                if (data.setupUrl) {
                    setResetUrl(data.setupUrl);
                    addNotification('Password reset created, but the email could not be sent. Copy the setup link.');
                } else {
                    setResetUrl(null);
                    addNotification('Password reset email sent. 2FA and passkey were disabled.');
                }
            } else {
                addNotification(data.message || 'Failed to send the password reset.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const handleDelete = async (user: DashboardUser) => {
        if (busy) return;
        if (!window.confirm(`Delete the account ${user.email}?`)) return;
        setBusy(true);
        try {
            const response = await fetch(`/api/users/${encodeURIComponent(user.email)}`, { method: 'DELETE' });
            if (response.ok) {
                addNotification('User deleted.');
                if (editTarget?.email === user.email) setEditTarget(null);
                await fetchUsers();
            } else {
                const data = await response.json().catch(() => ({}));
                addNotification(data.message || 'Failed to delete user.');
            }
        } catch {
            addNotification('Request failed.');
        } finally {
            setBusy(false);
        }
    };

    const copySetupUrl = () => {
        if (!setupUrl) return;
        navigator.clipboard?.writeText(setupUrl).then(
            () => addNotification('Setup link copied to clipboard.'),
            () => addNotification('Could not copy the setup link.')
        );
    };

    const copyResetUrl = () => {
        if (!resetUrl) return;
        navigator.clipboard?.writeText(resetUrl).then(
            () => addNotification('Reset link copied to clipboard.'),
            () => addNotification('Could not copy the reset link.')
        );
    };

    if (!isAdmin) {
        return (
            <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
                <PageHeader title="Users" />
                <Card>
                    <EmptyState
                        icon={<FiUsers size={26} />}
                        title="Administrator access required"
                        description="Your account does not have permission to manage users."
                    />
                </Card>
            </DashboardLayout>
        );
    }

    const columns: TableColumn<DashboardUser>[] = [
        {
            key: 'email',
            header: 'Email',
            render: (user) => (
                <span className="dash-cell-truncate">
                    {user.email}
                    {user.immutable ? <span className="dash-faint"> (environment)</span> : null}
                </span>
            ),
        },
        { key: 'role', header: 'Role', render: (user) => <Badge tone={user.role === 'admin' ? 'accent' : 'neutral'}>{user.role}</Badge> },
        { key: 'limit', header: 'Limit', render: (user) => (user.role === 'admin' ? '—' : user.permanentDeleteLimit) },
        {
            key: 'status',
            header: 'Invitation',
            render: (user) => (user.status === 'invited' ? <Badge tone="warning">invited</Badge> : <Badge>active</Badge>),
        },
        { key: 'totp', header: '2FA', render: (user) => (user.totpEnabled ? <Badge tone="accent">on</Badge> : <span className="dash-faint">off</span>) },
        { key: 'passkey', header: 'Passkey', render: (user) => (user.hasPasskey ? <Badge tone="permanent">yes</Badge> : <span className="dash-faint">—</span>) },
        { key: 'createdAt', header: 'Created', render: (user) => <span className="dash-muted">{formatDate(user.createdAt)}</span> },
        {
            key: 'actions',
            header: '',
            align: 'right',
            render: (user) => (
                <span className="dash-cell-actions">
                    {user.invitePending && !user.immutable && (
                        <IconButton label={`Resend invitation for ${user.email}`} onClick={() => void handleResendInvite(user)} disabled={busy}>
                            <FiRefreshCw />
                        </IconButton>
                    )}
                    {user.totpEnabled && (
                        <IconButton label={`Reset 2FA for ${user.email}`} onClick={() => void handleResetTotp(user)} disabled={busy}>
                            <FiShield />
                        </IconButton>
                    )}
                    <IconButton label={`Edit ${user.email}`} onClick={() => handleEdit(user)} disabled={busy}>
                        <FiEdit2 />
                    </IconButton>
                    {!user.immutable && (
                        <IconButton label={`Delete ${user.email}`} tone="danger" onClick={() => void handleDelete(user)} disabled={busy}>
                            <FiTrash2 />
                        </IconButton>
                    )}
                </span>
            ),
        },
    ];

    return (
        <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
            <PageHeader title="Users" description="Invite teammates and control their access and permanent-delete limit." />

            <Card
                title="Invite a user"
                description="New accounts are invitations: the person sets their password and enables 2FA from the setup link."
                animationDelay={0}
            >
                <div className="dash-row" style={{ alignItems: 'flex-end' }}>
                    <Input
                        label="Email"
                        type="email"
                        placeholder="name@example.com"
                        value={form.email}
                        onChange={(event) => setForm((prev) => ({ ...prev, email: event.target.value }))}
                        style={{ minWidth: 220 }}
                    />
                    <Select
                        label="Role"
                        value={form.role}
                        onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value as SessionRole }))}
                    >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                    </Select>
                    <Input
                        label="Permanent limit"
                        type="number"
                        min={0}
                        value={form.permanentDeleteLimit}
                        onChange={(event) => setForm((prev) => ({ ...prev, permanentDeleteLimit: event.target.value }))}
                    />
                    <Button variant="primary" icon={<FiUserPlus />} onClick={() => void handleCreate()} disabled={busy}>
                        Create
                    </Button>
                </div>

                {setupUrl && (
                    <div className="dash-setup-url">
                        <Input readOnly value={setupUrl} onFocus={(event) => event.target.select()} aria-label="Manual setup link" />
                        <IconButton label="Copy setup link" onClick={copySetupUrl}>
                            <FiClipboard />
                        </IconButton>
                    </div>
                )}
            </Card>

            <Card title="Accounts" description={`${users.length} account${users.length === 1 ? '' : 's'} in total.`} animationDelay={80}>
                <Table
                    columns={columns}
                    rows={users}
                    rowKey={(user) => user.email}
                    loading={loading}
                    loadingLabel="Loading users..."
                    empty={<EmptyState icon={<FiUsers size={26} />} title="No users" description="Invite your first teammate above." />}
                />
            </Card>

            {editTarget && (
                <Modal
                    title={`Edit ${editTarget.email}`}
                    onClose={() => setEditTarget(null)}
                    footer={
                        editTarget.immutable ? (
                            <Button variant="ghost" onClick={() => setEditTarget(null)}>
                                Close
                            </Button>
                        ) : (
                            <>
                                <Button variant="ghost" onClick={() => setEditTarget(null)}>
                                    Cancel
                                </Button>
                                <Button variant="primary" icon={<FiSave />} disabled={editBusy} onClick={() => void handleSaveEdit()}>
                                    {editBusy ? 'Saving...' : 'Save'}
                                </Button>
                            </>
                        )
                    }
                >
                    <div className="dash-stack">
                        {editTarget.immutable ? (
                            <Callout>
                                The environment administrator&apos;s role and limit are fixed. Security recovery actions below still
                                apply.
                            </Callout>
                        ) : (
                            <>
                                <Select
                                    label="Role"
                                    value={editForm.role}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, role: event.target.value as SessionRole }))}
                                >
                                    <option value="user">user</option>
                                    <option value="admin">admin</option>
                                </Select>
                                <Input
                                    label="Permanent delete limit"
                                    type="number"
                                    min={0}
                                    value={editForm.permanentDeleteLimit}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, permanentDeleteLimit: event.target.value }))}
                                />
                                <Input
                                    label="New password (optional)"
                                    type="password"
                                    autoComplete="new-password"
                                    placeholder="Leave blank to keep the current password"
                                    value={editForm.password}
                                    onChange={(event) => setEditForm((prev) => ({ ...prev, password: event.target.value }))}
                                />
                            </>
                        )}

                        <div className="dash-divider" />

                        <div className="dash-stack">
                            <span className="dash-label">Security</span>
                            <div className="dash-row">
                                <span className="dash-muted" style={{ minWidth: 72 }}>
                                    2FA
                                </span>
                                {editTarget.totpEnabled ? <Badge tone="accent">on</Badge> : <Badge>off</Badge>}
                            </div>
                            <div className="dash-row">
                                <span className="dash-muted" style={{ minWidth: 72 }}>
                                    Passkey
                                </span>
                                {editTarget.hasPasskey ? <Badge tone="permanent">registered</Badge> : <Badge>none</Badge>}
                            </div>
                        </div>

                        <div className="dash-stack">
                            <SecurityAction
                                title="Remove passkey"
                                description="Disables passkey sign in and lets the user sign in with their password again."
                                actionLabel="Remove passkey"
                                tone="danger"
                                icon={<FiKey />}
                                disabled={busy || !editTarget.hasPasskey}
                                onAction={() => void handleRemovePasskey(editTarget)}
                            />
                            <SecurityAction
                                title="Reset 2FA"
                                description="The user must configure 2FA again on their next sign in."
                                actionLabel="Reset 2FA"
                                tone="warning"
                                icon={<FiShield />}
                                disabled={busy || !editTarget.totpEnabled}
                                onAction={() => void handleResetTotp(editTarget)}
                            />
                            <SecurityAction
                                title="Send password reset"
                                description="Sends an email and disables 2FA and passkey so the user can get back in."
                                actionLabel="Send password reset"
                                icon={<FiMail />}
                                disabled={busy}
                                onAction={() => void handleSendPasswordReset(editTarget)}
                            />
                        </div>

                        {resetUrl && (
                            <div className="dash-setup-url">
                                <Input
                                    readOnly
                                    value={resetUrl}
                                    onFocus={(event) => event.target.select()}
                                    aria-label="Manual password reset link"
                                />
                                <IconButton label="Copy reset link" onClick={copyResetUrl}>
                                    <FiClipboard />
                                </IconButton>
                            </div>
                        )}
                    </div>
                </Modal>
            )}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
