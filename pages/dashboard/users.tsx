import { useCallback, useEffect, useState } from 'react';
import type { GetServerSideProps } from 'next';
import { FiClipboard, FiEdit2, FiRefreshCw, FiSave, FiShield, FiTrash2, FiUserPlus, FiUsers } from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import {
    Badge,
    Button,
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

    const fetchUsers = useCallback(async () => {
        if (!isAdmin) {
            setLoading(false);
            return;
        }
        setLoading(true);
        try {
            const response = await fetch('/api/users');
            if (response.ok) setUsers(await response.json());
            else if (response.status === 403) addNotification('Admin access is required to manage users.');
        } catch {
            addNotification('Failed to load users.');
        } finally {
            setLoading(false);
        }
    }, [isAdmin, addNotification]);

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
                await fetchUsers();
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
                    {!user.immutable && (
                        <>
                            <IconButton label={`Edit ${user.email}`} onClick={() => handleEdit(user)} disabled={busy}>
                                <FiEdit2 />
                            </IconButton>
                            <IconButton label={`Delete ${user.email}`} tone="danger" onClick={() => void handleDelete(user)} disabled={busy}>
                                <FiTrash2 />
                            </IconButton>
                        </>
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
                        <>
                            <Button variant="ghost" onClick={() => setEditTarget(null)}>
                                Cancel
                            </Button>
                            <Button variant="primary" icon={<FiSave />} disabled={editBusy} onClick={() => void handleSaveEdit()}>
                                {editBusy ? 'Saving...' : 'Save'}
                            </Button>
                        </>
                    }
                >
                    <div className="dash-stack">
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
                    </div>
                </Modal>
            )}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
