import type { NextApiRequest, NextApiResponse } from 'next';
import { hasAnyPasskey, hasPasskey } from '../../../../utils/passkeys';

function firstQueryValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

// Public: the login page needs to know whether to offer the passkey button, and
// the account page asks for a specific email to show its own status.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'GET') {
            res.setHeader('Allow', ['GET']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const email = firstQueryValue(req.query.email).trim();
        const registered = await hasAnyPasskey();

        if (!email) {
            return res.status(200).json({ registered });
        }

        return res.status(200).json({ registered, hasPasskey: await hasPasskey(email) });
    } catch (error) {
        console.error('GET /api/auth/passkey/status error:', error);
        return res.status(500).json({ message: 'Failed to read passkey status' });
    }
}
