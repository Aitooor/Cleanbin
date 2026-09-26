import type { NextApiRequest, NextApiResponse } from 'next';
import { clearSessionCookie, requireSession } from '../../../utils/auth';
import { getSession, revokeSession } from '../../../utils/sessions';

function firstQueryValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

// Revokes one session by id. A user may revoke their own devices; an admin may
// additionally revoke any other account's session.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'DELETE') {
        res.setHeader('Allow', ['DELETE']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    const session = await requireSession(req, res);
    if (!session) return;

    const id = firstQueryValue(req.query.id);
    if (!id) {
        return res.status(400).json({ message: 'Session id is required' });
    }

    const record = await getSession(id);
    if (!record) {
        return res.status(404).json({ message: 'Session not found' });
    }

    const ownsSession = record.email === session.email;
    if (!ownsSession && session.role !== 'admin') {
        return res.status(403).json({ message: 'Forbidden' });
    }

    const revoked = await revokeSession(id);
    // Signing yourself out must also drop the cookie you are holding.
    if (id === session.sid) clearSessionCookie(res);

    return res.status(200).json({ message: revoked ? 'Session revoked' : 'Session already revoked' });
}
