import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import type { GetServerSideProps } from 'next';
import { FiExternalLink, FiFileText, FiPlus, FiUserPlus, FiUsers } from 'react-icons/fi';
import DashboardLayout from '../../components/dashboard/DashboardLayout';
import { Badge, Button, Card, EmptyState, PageHeader, StatCard, Table, LoadingState } from '../../components/dashboard/ui';
import type { DashboardSession, Paste, TableColumn } from '../../components/dashboard/types';
import { formatDateTime } from '../../components/dashboard/format';
import { getDashboardSessionProps } from '../../utils/dashboardSession';
import { useNotification } from '../../components/NotificationProvider';

const SAMPLE_SIZE = 1000;

function isPermanent(paste: Paste): boolean {
    return String(paste.permanent) === 'true' || paste.permanent === true;
}

export default function OverviewPage({ sessionEmail, sessionRole, permanentDeleteLimit }: DashboardSession) {
    const router = useRouter();
    const { addNotification } = useNotification();
    const isAdmin = sessionRole === 'admin';

    const [pastes, setPastes] = useState<Paste[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [usersCount, setUsersCount] = useState<number | null>(null);

    useEffect(() => {
        let active = true;
        fetch(`/api/pastes?page=1&limit=${SAMPLE_SIZE}`)
            .then((response) => (response.ok ? response.json() : Promise.reject()))
            .then((body) => {
                if (!active) return;
                setPastes(Array.isArray(body.items) ? body.items : []);
                setTotal(typeof body.total === 'number' ? body.total : 0);
            })
            .catch(() => {})
            .finally(() => {
                if (active) setLoading(false);
            });
        return () => {
            active = false;
        };
    }, []);

    useEffect(() => {
        if (!isAdmin) return;
        let active = true;
        fetch('/api/users')
            .then((response) => (response.ok ? response.json() : Promise.reject()))
            .then((list) => {
                if (active) setUsersCount(Array.isArray(list) ? list.length : 0);
            })
            .catch(() => {});
        return () => {
            active = false;
        };
    }, [isAdmin]);

    const permanentCount = useMemo(() => pastes.filter(isPermanent).length, [pastes]);
    const temporaryCount = pastes.length - permanentCount;
    const recentPastes = useMemo(() => pastes.slice(0, 10), [pastes]);
    const sampleHint = total > pastes.length ? `of latest ${pastes.length}` : undefined;

    const copyId = (id: string) => {
        navigator.clipboard?.writeText(id).then(
            () => addNotification('UUID copied to clipboard'),
            () => addNotification('Could not copy the UUID')
        );
    };

    const recentColumns: TableColumn<Paste>[] = [
        {
            key: 'name',
            header: 'Name',
            render: (row) => <span className="dash-cell-truncate">{row.name || 'Untitled'}</span>,
        },
        {
            key: 'id',
            header: 'UUID',
            render: (row) => (
                <button type="button" className="dash-mono-id" onClick={() => copyId(row.id)} title="Copy UUID">
                    {row.id}
                </button>
            ),
        },
        {
            key: 'permanent',
            header: 'Type',
            render: (row) => (isPermanent(row) ? <Badge tone="permanent">permanent</Badge> : <Badge>temporary</Badge>),
        },
        { key: 'createdAt', header: 'Created', render: (row) => <span className="dash-muted">{formatDateTime(row.createdAt)}</span> },
        {
            key: 'actions',
            header: '',
            align: 'right',
            render: (row) => (
                <span className="dash-cell-actions">
                    <Button size="sm" variant="ghost" icon={<FiExternalLink />} onClick={() => window.open(`/${row.id}`, '_blank')}>
                        Open
                    </Button>
                </span>
            ),
        },
    ];

    return (
        <DashboardLayout sessionEmail={sessionEmail} sessionRole={sessionRole} permanentDeleteLimit={permanentDeleteLimit}>
            <PageHeader
                title="Overview"
                description="A quick read on your pastes and account health."
                actions={
                    <>
                        <Button variant="primary" icon={<FiPlus />} onClick={() => router.push('/')}>
                            New paste
                        </Button>
                        {isAdmin && (
                            <Button icon={<FiUserPlus />} onClick={() => router.push('/dashboard/users')}>
                                Create user
                            </Button>
                        )}
                    </>
                }
            />

            <div className="dash-grid">
                <StatCard label="Total pastes" value={loading ? '—' : total} tone="accent" animationDelay={0} />
                <StatCard label="Permanent" value={loading ? '—' : permanentCount} tone="permanent" hint={sampleHint} animationDelay={40} />
                <StatCard label="Temporary" value={loading ? '—' : temporaryCount} tone="warning" hint={sampleHint} animationDelay={80} />
                {isAdmin && (
                    <StatCard label="Users" value={usersCount ?? '—'} animationDelay={120} />
                )}
            </div>

            <Card title="Recent pastes" description="The ten most recently created entries." animationDelay={160}>
                {loading ? (
                    <LoadingState label="Loading pastes..." />
                ) : (
                    <Table
                        columns={recentColumns}
                        rows={recentPastes}
                        rowKey={(row) => row.id}
                        empty={
                            <EmptyState
                                icon={<FiFileText size={26} />}
                                title="No pastes yet"
                                description="Create your first paste from the editor and it will show up here."
                                action={
                                    <Button variant="primary" icon={<FiPlus />} onClick={() => router.push('/')}>
                                        New paste
                                    </Button>
                                }
                            />
                        }
                    />
                )}
            </Card>
        </DashboardLayout>
    );
}

export const getServerSideProps: GetServerSideProps = async (context) => getDashboardSessionProps(context);
