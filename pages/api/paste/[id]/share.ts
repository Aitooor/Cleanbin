import { NextApiRequest, NextApiResponse } from 'next';
import { getPaste, updatePaste } from '../../../../utils/db';
import { requireSession } from '../../../../utils/auth';
import { getOwner, getSharedWith, isAdmin, isOwner, normalizeEmail } from '../../../../utils/pasteAccess';
import { getUser } from '../../../../utils/users';
import { isValidPasteId } from '../../../../utils/validation';

export const config = {
    api: {
        bodyParser: {
            sizeLimit: '64kb',
        },
    },
};

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

// Grants or revokes edit access to a paste. Only the paste owner or an admin
// may change the access list, and the target must be a known user account.
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

        if (!isAdmin(session) && !isOwner(paste, session.email)) {
            return res.status(403).json({ error: 'Only the owner or an admin can manage access' });
        }

        const { email, action } = req.body || {};
        if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
            return res.status(400).json({ message: 'A valid email is required' });
        }
        if (action !== 'add' && action !== 'remove') {
            return res.status(400).json({ message: 'Action must be "add" or "remove"' });
        }

        const target = normalizeEmail(email);
        if (action === 'add') {
            const user = await getUser(target);
            if (!user) {
                return res.status(404).json({ message: 'No user account exists with that email' });
            }
            const owner = getOwner(paste);
            if (owner !== null && owner === target) {
                return res.status(400).json({ message: 'The owner already has access' });
            }
        }

        const shared = new Set(getSharedWith(paste));
        if (action === 'add') shared.add(target);
        else shared.delete(target);
        // The owner is implied and never needs to appear in the share list.
        const owner = getOwner(paste);
        if (owner !== null) shared.delete(owner);

        const result = await updatePaste(id, { sharedWith: [...shared] });
        if (result.status === 'not_found') {
            return res.status(404).json({ message: 'Paste not found' });
        }
        if (result.status === 'conflict') {
            // No optimistic version was sent, so a conflict is unexpected here.
            return res.status(409).json({ error: 'The paste changed, please retry' });
        }

        return res.status(200).json({
            sharedWith: getSharedWith(result.paste),
            owner: getOwner(result.paste),
        });
    } catch (error) {
        console.error('/api/paste/[id]/share error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
