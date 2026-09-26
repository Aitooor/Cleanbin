import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { startRegistration } from '@simplewebauthn/browser';
import { FiKey, FiLogOut, FiShield, FiTrash2 } from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import { Badge, Button, Callout, Card, LoadingState, PageHeader } from '../../components/dashboard/ui';
import type { DashboardSession } from '../../components/dashboard/types';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
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

    const handleRegisterPasskey = async () => {
        if (passkeyBusy) return;
        if (typeof window !== 'undefined' && !window.confirm(PASSKEY_WARNING)) return;
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

    const handleLogout = () => {
        localStorage.removeItem('authToken');
        document.cookie = 'auth-token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 UTC;';
        router.push('/login');
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
                        actions={
                            passkeyRegistered ? (
                                <Button variant="danger" icon={<FiTrash2 />} onClick={() => void handleRemovePasskey()} disabled={passkeyBusy}>
                                    Remove passkey
                                </Button>
                            ) : (
                                <Button variant="primary" icon={<FiKey />} onClick={() => void handleRegisterPasskey()} disabled={passkeyBusy}>
                                    Register passkey
                                </Button>
                            )
                        }
                        animationDelay={0}
                    >
                        <div className="dash-row">
                            <span className="dash-muted">Status</span>
                            {passkeyRegistered ? <Badge tone="permanent">registered</Badge> : <Badge>not registered</Badge>}
                        </div>
                        <Callout tone={passkeyRegistered ? 'warning' : 'default'}>
                            {passkeyRegistered
                                ? 'Password sign in is disabled and 2FA has been removed. Sign in with this passkey.'
                                : 'Registering a passkey disables password sign in and removes your 2FA. Only do this on a device you trust.'}
                        </Callout>
                    </Card>

                    <Card
                        title="Two-factor authentication"
                        description="Every password login requires a 6-digit code from your authenticator app."
                        animationDelay={80}
                    >
                        <div className="dash-row">
                            <FiShield aria-hidden="true" />
                            <span className="dash-muted">Status</span>
                            {totpEnabled ? <Badge tone="accent">enabled</Badge> : <Badge tone="warning">removed</Badge>}
                        </div>
                        <p className="dash-note">
                            {passkeyRegistered
                                ? 'Your passkey replaced 2FA. Remove the passkey to go back to password + 2FA.'
                                : 'To reset 2FA, an administrator can send you a new setup link from the Users page.'}
                        </p>
                    </Card>

                    <Card title="Session" description="Your identity and sign-out options." animationDelay={160}>
                        <div className="dash-stack">
                            <div className="dash-row">
                                <span className="dash-muted" style={{ minWidth: 120 }}>
                                    Email
                                </span>
                                <span>{sessionEmail}</span>
                            </div>
                            <div className="dash-row">
                                <span className="dash-muted" style={{ minWidth: 120 }}>
                                    Role
                                </span>
                                <Badge tone={isAdmin ? 'accent' : 'neutral'}>{sessionRole}</Badge>
                            </div>
                            {!isAdmin && permanentDeleteLimit !== null && (
                                <div className="dash-row">
                                    <span className="dash-muted" style={{ minWidth: 120 }}>
                                        Permanent limit
                                    </span>
                                    <span>{permanentDeleteLimit} per operation</span>
                                </div>
                            )}
                            <div>
                                <Button variant="danger" icon={<FiLogOut />} onClick={handleLogout}>
                                    Sign out
                                </Button>
                            </div>
                        </div>
                    </Card>
                </>
            )}
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
