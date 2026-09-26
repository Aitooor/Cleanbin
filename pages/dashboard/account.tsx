import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { startRegistration } from '@simplewebauthn/browser';
import { FiKey, FiLogOut, FiShield, FiTrash2 } from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import ConfirmModal, { type ConfirmRequest } from '../../components/dashboard/ConfirmModal';
import { Badge, Button, Callout, Card, LoadingState, PageHeader } from '../../components/dashboard/ui';
import type { DashboardSession, DashboardSessionInfo } from '../../components/dashboard/types';
import { describeUserAgent, formatDateTime } from '../../components/dashboard/format';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
import { clearAuthCookie, revokeCurrentSession } from '../../components/dashboard/clientSession';
import { useNotification } from '../../components/NotificationProvider';

const PASSKEY_WARNING =
    'Registering a passkey will:\n\n' +
    '1. Disable password sign in for this account.\n' +
    '2. Remove your 2FA (TOTP) if you have it enabled.\n\n' +
    'You will sign in with the passkey from now on. Continue?';

export default function AccountPage({ sessionEmail, sessionRole, permanentDeleteLimit }: DashboardSession) {
    const router = useRouter();
    const { addNotification } = useNotification();
    const isAdmin = sessionRole === 'admin';

    const [passkeyRegistered, setPasskeyRegistered] = useState<boolean | null>(null);
    const [passkeyBusy, setPasskeyBusy] = useState(false);
    // 2FA is mandatory for password logins, so a session without a passkey
    // implies TOTP is enabled. An exact value is read for admins.
    const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
    const [sessions, setSessions] = useState<DashboardSessionInfo[] | null>(null);
    const [confirm, setConfirm] = useState<ConfirmRequest | null>(null);

    const loadSessions = useCallback(async () => {
        try {
            const response = await fetch('/api/sessions');
            if (!response.ok) throw new Error('sessions');
            const data = await response.json();
            setSessions(Array.isArray(data.sessions) ? data.sessions : []);
        } catch {
            setSessions([]);
            addNotification('Could not load your sessions.');
        }
    }, [addNotification]);

    useEffect(() => {
        let active = true;
        fetch(`/api/auth/passkey/status?email=${encodeURIComponent(sessionEmail)}`)
            .then((response) => (response.ok ? response.json() : Promise.reject()))
            .then((data) => {
                if (active) setPasskeyRegistered(!!data.hasPasskey);
            })
            .catch(() => {
                if (active) setPasskeyRegistered(false);
            });
        return () => {
            active = false;
        };
    }, [sessionEmail]);

    useEffect(() => {
        if (passkeyRegistered === null) return;
        if (passkeyRegistered) {
            setTotpEnabled(false);
            return;
        }
        if (!isAdmin) {
            setTotpEnabled(true);
            return;
        }
        let active = true;
        fetch('/api/users')
            .then((response) => (response.ok ? response.json() : Promise.reject()))
            .then((list: { email: string; totpEnabled: boolean }[]) => {
                if (!active) return;
                const self = list.find((user) => user.email.toLowerCase() === sessionEmail.toLowerCase());
                setTotpEnabled(self ? self.totpEnabled : true);
            })
            .catch(() => {
                if (active) setTotpEnabled(true);
            });
        return () => {
            active = false;
        };
    }, [passkeyRegistered, isAdmin, sessionEmail]);

    useEffect(() => {
        void loadSessions();
    }, [loadSessions]);

    const performRegisterPasskey = async () => {
        setPasskeyBusy(true);
        try {
            const optionsResponse = await fetch('/api/auth/passkey/register-options', { method: 'POST' });
            if (!optionsResponse.ok) {
                addNotification('Could not start passkey registration.');
                return;
            }
            const optionsJSON = await optionsResponse.json();
            const registrationResponse = await startRegistration({ optionsJSON });
            const verifyResponse = await fetch('/api/auth/passkey/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ response: registrationResponse }),
            });
            if (verifyResponse.ok) {
                const data = await verifyResponse.json().catch(() => ({}));
                setPasskeyRegistered(true);
                setTotpEnabled(false);
                addNotification(data?.totpRemoved ? 'Passkey registered. Password sign in disabled and 2FA removed.' : 'Passkey registered. Password sign in is now disabled.');
            } else {
                const data = await verifyResponse.json().catch(() => ({}));
                addNotification(data.message || 'Passkey registration failed.');
            }
        } catch {
            addNotification('Passkey registration was cancelled.');
        } finally {
            setPasskeyBusy(false);
        }
    };

    const handleRegisterPasskey = () => {
        if (passkeyBusy) return;
        setConfirm({
            title: 'Register passkey',
            description: PASSKEY_WARNING,
            confirmLabel: 'Register passkey',
            tone: 'primary',
            onConfirm: () => {
                setConfirm(null);
                void performRegisterPasskey();
            },
        });
    };

    const handleRemovePasskey = async () => {
        if (passkeyBusy) return;
        setPasskeyBusy(true);
        try {
            const response = await fetch('/api/auth/passkey', { method: 'DELETE' });
            if (response.ok) {
                setPasskeyRegistered(false);
                setTotpEnabled(true);
                addNotification('Passkey removed. Password login is enabled again.');
            } else {
                addNotification('Failed to remove passkey.');
            }
        } catch {
            addNotification('Failed to remove passkey.');
        } finally {
            setPasskeyBusy(false);
        }
    };

    const handleLogout = async () => {
        await revokeCurrentSession();
        clearAuthCookie();
        router.push('/login');
    };

    const handleRevokeSession = (session: DashboardSessionInfo) => {
        setConfirm({
            title: session.current ? 'Sign out' : 'Sign out device',
            description: session.current
                ? 'Sign out of Cleanbin on this device?'
                : `Sign out of Cleanbin on ${describeUserAgent(session.userAgent)}? That device will need to sign in again.`,
            confirmLabel: 'Sign out',
            tone: 'danger',
            onConfirm: () => {
                setConfirm(null);
                void performRevokeSession(session);
            },
        });
    };

    const performRevokeSession = async (session: DashboardSessionInfo) => {
        try {
            const response = await fetch(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' });
            if (!response.ok) {
                addNotification('Failed to sign out that session.');
                return;
            }
            if (session.current) {
                clearAuthCookie();
                router.push('/login');
                return;
            }
            addNotification('Session signed out.');
            await loadSessions();
        } catch {
            addNotification('Failed to sign out that session.');
        }
    };

    const loading = passkeyRegistered === null;

    return (
        <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
            <PageHeader title="Account" description="Manage how you sign in to Cleanbin." />

            {loading ? (
                <Card>
                    <LoadingState label="Loading account..." />
                </Card>
            ) : (
                <>
                    <Card
                        title="Passkey"
                        description="A passkey replaces both your password and your 2FA."
                        animationDelay={0}
                    >
                        <div className="dash-account-section">
                            <div className="dash-account-status">
                                <span className="dash-label">Status</span>
                                {passkeyRegistered ? <Badge tone="permanent">registered</Badge> : <Badge>not registered</Badge>}
                            </div>
                            <Callout tone={passkeyRegistered ? 'warning' : 'default'}>
                                {passkeyRegistered
                                    ? 'Password sign in is disabled and 2FA has been removed. Sign in with this passkey.'
                                    : 'Registering a passkey disables password sign in and removes your 2FA. Only do this on a device you trust.'}
                            </Callout>
                            <div className="dash-account-actions">
                                {passkeyRegistered ? (
                                    <Button variant="danger" icon={<FiTrash2 />} onClick={() => void handleRemovePasskey()} disabled={passkeyBusy}>
                                        Remove passkey
                                    </Button>
                                ) : (
                                    <Button variant="primary" icon={<FiKey />} onClick={handleRegisterPasskey} disabled={passkeyBusy}>
                                        Register passkey
                                    </Button>
                                )}
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="Two-factor authentication"
                        description="Every password login requires a 6-digit code from your authenticator app."
                        animationDelay={80}
                    >
                        <div className="dash-account-section">
                            <div className="dash-account-status">
                                <span className="dash-label">Status</span>
                                {totpEnabled ? <Badge tone="accent">enabled</Badge> : <Badge tone="warning">removed</Badge>}
                            </div>
                            <p className="dash-note">
                                {passkeyRegistered
                                    ? 'Your passkey replaced 2FA. Remove the passkey to go back to password + 2FA.'
                                    : 'To reset 2FA, an administrator can send you a new setup link from the Users page.'}
                            </p>
                        </div>
                    </Card>

                    <Card title="Account" description="Your identity and sign-out options." animationDelay={160}>
                        <div className="dash-account-section">
                            <div className="dash-account-field">
                                <span className="dash-account-field-label">Email</span>
                                <span>{sessionEmail}</span>
                            </div>
                            <div className="dash-account-field">
                                <span className="dash-account-field-label">Role</span>
                                <Badge tone={isAdmin ? 'accent' : 'neutral'}>{sessionRole}</Badge>
                            </div>
                            {!isAdmin && permanentDeleteLimit !== null && (
                                <div className="dash-account-field">
                                    <span className="dash-account-field-label">Permanent limit</span>
                                    <span>{permanentDeleteLimit} per operation</span>
                                </div>
                            )}
                            <div className="dash-account-actions">
                                <Button variant="danger" icon={<FiLogOut />} onClick={() => void handleLogout()}>
                                    Sign out
                                </Button>
                            </div>
                        </div>
                    </Card>

                    <Card
                        title="Sessions"
                        description="Devices currently signed in to your account. Sign out any device you do not recognise."
                        animationDelay={240}
                    >
                        {sessions === null ? (
                            <LoadingState label="Loading sessions..." />
                        ) : sessions.length === 0 ? (
                            <p className="dash-note">No other sessions are active.</p>
                        ) : (
                            <div className="dash-account-section">
                                <div className="dash-session-list">
                                    {sessions.map((session) => (
                                        <div key={session.id} className="dash-session-row">
                                            <div className="dash-session-info">
                                                <span className="dash-session-device">
                                                    {describeUserAgent(session.userAgent)}
                                                    {session.current && <Badge tone="accent">this device</Badge>}
                                                </span>
                                                <span className="dash-session-meta">
                                                    Signed in {formatDateTime(session.createdAt)} · last seen {formatDateTime(session.lastSeenAt)}
                                                </span>
                                            </div>
                                            <Button variant="ghost" size="sm" icon={<FiLogOut />} onClick={() => handleRevokeSession(session)}>
                                                Sign out
                                            </Button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}
                    </Card>
                </>
            )}

            {confirm && <ConfirmModal {...confirm} onClose={() => setConfirm(null)} />}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
