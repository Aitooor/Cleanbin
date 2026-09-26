import type { NextApiRequest, NextApiResponse } from 'next';
import { requireSession } from '../../../../utils/auth';
import { deletePasskey } from '../../../../utils/passkeys';

// Removing the passkey restores password login, so it requires a valid session.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method !== 'DELETE') {
            res.setHeader('Allow', ['DELETE']);
            return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
        }

        const session = requireSession(req, res);
        if (!session) return;

        await deletePasskey();
        return res.status(200).json({ message: 'Passkey removed' });
    } catch (error) {
        console.error('DELETE /api/auth/passkey error:', error);
        return res.status(500).json({ message: 'Failed to remove passkey' });
    }
}
