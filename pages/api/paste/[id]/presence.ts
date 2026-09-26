import { NextApiRequest, NextApiResponse } from 'next';
import { getPaste } from '../../../../utils/db';
import { requireSession } from '../../../../utils/auth';
import { canEdit, normalizeEmail } from '../../../../utils/pasteAccess';
import { heartbeat } from '../../../../utils/presence';
import { isValidPasteId } from '../../../../utils/validation';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '8kb',
        },
    },
};

// Heartbeat endpoint for the "someone else is editing" indicator. Each poll
// refreshes the caller's presence and returns who else is active on the paste.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const session = requireSession(req, res);
        if (!session) return;

        const { id } = req.query;
        if (!isValidPasteId(id)) {
            return res.status(400).json({ message: 'Invalid ID' });
        }

        const paste = await getPaste(id);
        if (!paste) {
            return res.status(404).json({ message: 'Paste not found' });
        }
        if (!canEdit(paste, session)) {
            return res.status(403).json({ error: 'You do not have access to this paste' });
        }

        const editors = heartbeat(id, session.email);
        return res.status(200).json({ self: normalizeEmail(session.email), editors });
    } catch (error) {
        console.error('/api/paste/[id]/presence error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
