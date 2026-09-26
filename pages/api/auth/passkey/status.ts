import type { NextApiRequest, NextApiResponse } from 'next';
import { hasPasskey } from '../../../../utils/passkeys';

// Public: the login page needs to know whether to offer the passkey button.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'GET') {
            res.setHeader('Allow', ['GET']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const registered = await hasPasskey();
        return res.status(200).json({ registered });
    } catch (error) {
        console.error('GET /api/auth/passkey/status error:', error);
        return res.status(500).json({ message: 'Failed to read passkey status' });
    }
}
