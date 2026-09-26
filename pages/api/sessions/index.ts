import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookie, requireSession } from '../../../utils/auth';
import { listUserSessions, revokeSession, type SessionRecord } from '../../../utils/sessions';
import type { DashboardSessionInfo } from '../../../components/dashboard/types';

export function toPublicSession(record: SessionRecord, currentId: string): DashboardSessionInfo {
    return {
        id: record.id,
        email: record.email,
        role: record.role,
        userAgent: record.userAgent,
        createdAt: record.createdAt,
        lastSeenAt: record.lastSeenAt,
        current: record.id === currentId,
    };
}

// GET lists the caller's own active sessions. DELETE revokes the session that
// made the request (the current device) and expires its cookie.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const session = await requireSession(req, res);
    if (!session) return;

    if (req.method === 'GET') {
        const records = await listUserSessions(session.email);
        return res.status(200).json({
            currentId: session.sid,
            sessions: records.map((record) => toPublicSession(record, session.sid)),
        });
    }

    if (req.method === 'DELETE') {
        await revokeSession(session.sid);
        clearSessionCookie(res);
        return res.status(200).json({ message: 'Signed out' });
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
}
