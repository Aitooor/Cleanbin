import { NextApiRequest, NextApiResponse } from 'next';
import { getPaste } from '../../../utils/db';
import { requireSession } from '../../../utils/auth';
import { canEdit } from '../../../utils/pasteAccess';
import { viewersFor } from '../../../utils/presence';
import { isValidPasteId } from '../../../utils/validation';

// Cap the number of ids inspected in one poll: the dashboard only asks about
// the pastes currently on screen.
const MAX_IDS = 100;

// Read-only batch presence: returns `{ [pasteId]: editors[] }` for the visible
// pastes so the listing can show a discreet editing dot without one request per
// row. Only pastes the caller may access are reported.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'GET') {
        res.setHeader('Allow', ['GET']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const session = await requireSession(req, res);
        if (!session) return;

        const rawIds = ((req.query.ids as string) || '')
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
            .slice(0, MAX_IDS)
            .filter((id) => isValidPasteId(id));

        const allowed: string[] = [];
        for (const id of rawIds) {
            const paste = await getPaste(id);
            if (paste && canEdit(paste, session)) allowed.push(id);
        }

        return res.status(200).json({ editors: viewersFor(allowed, session.email) });
    } catch (error) {
        console.error('/api/pastes/presence error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
