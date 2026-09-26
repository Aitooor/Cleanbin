import type { GetServerSidePropsContext, GetServerSidePropsResult } from 'next';
import { parse } from 'cookie';
import type { DashboardSession } from '../components/dashboard/types';

// Shared server-side guard for every /dashboard page. Verifies the signed
// session cookie and exposes the session to the page as props. The middleware
// already redirects unauthenticated users; this is the defence in depth.
export async function getDashboardSessionProps(
    context: GetServerSidePropsContext
): Promise<GetServerSidePropsResult<DashboardSession>> {
    const cookies = context.req.headers.cookie ? parse(context.req.headers.cookie) : {};
    const { verifySessionToken } = await import('./auth');
    const session = verifySessionToken(cookies['auth-token']);

    if (!session) {
        return { redirect: { destination: '/login', permanent: false } };
    }

    const { getPermanentDeleteLimit } = await import('./users');
    const limit = session.role === 'admin' ? null : await getPermanentDeleteLimit(session.email);

    return {
        props: {
            sessionEmail: session.email,
            sessionRole: session.role,
            permanentDeleteLimit: typeof limit === 'number' && Number.isFinite(limit) ? limit : null,
        },
    };
}
