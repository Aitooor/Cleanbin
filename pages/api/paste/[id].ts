import { NextApiRequest, NextApiResponse } from 'next';
import { deletePaste, getPaste, updatePasteName } from '../../../utils/db';
import { invalidateCache, removePasteFromCache, updatePasteNameInCache } from '../../../utils/pastesCache';
import { requireSession } from '../../../utils/auth';
import { isValidPasteId } from '../../../utils/validation';

// Cap the request body size for this route (rename payloads are tiny, but be safe).
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        const { id } = req.query;

        if (!isValidPasteId(id)) {
            return res.status(400).json({ message: 'Invalid ID' });
        }

        if (req.method === 'GET') {
            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ error: 'Paste not found' });
            }
            const permanent = String(paste.permanent) === 'true';
            // For temporary pastes, expose expiresAt so the client can show a countdown.
            const expiresAt = permanent ? null : paste.expiresAt ?? null;
            return res.status(200).json({
                content: paste.content,
                name: paste.name ?? '',
                permanent,
                expiresAt,
            });
        }

        if (req.method === 'DELETE') {
            const session = requireSession(req, res);
            if (!session) return;

            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ message: 'Paste not found' });
            }

            await deletePaste(id);
            // update in-memory cache quickly
            try {
                removePasteFromCache(id);
            } catch (err) {
                try {
                    invalidateCache();
                } catch (e) {}
            }
            return res.status(200).json({ success: true });
        }

        if (req.method === 'PATCH') {
            const session = requireSession(req, res);
            if (!session) return;

            // Update the paste name
            const { name } = req.body || {};
            if (typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ message: 'Invalid name' });
            }

            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ message: 'Paste not found' });
            }

            const updated = await updatePasteName(id, name.trim());
            if (!updated) {
                return res.status(500).json({ message: 'Failed to update paste' });
            }
            // update cache entry name quickly
            try {
                updatePasteNameInCache(id, name.trim());
            } catch (err) {
                try {
                    invalidateCache();
                } catch (e) {}
            }

            return res.status(200).json({ success: true, paste: updated });
        }

        res.setHeader('Allow', ['GET', 'DELETE', 'PATCH']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    } catch (error) {
        console.error('/api/paste/[id] error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
