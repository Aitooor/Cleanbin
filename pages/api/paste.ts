import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { savePaste, getPaste } from '../../utils/db';
import { invalidateCache, addPasteToCache } from '../../utils/pastesCache';
import { getSessionFromRequest } from '../../utils/auth';
import { isValidPasteId, MAX_PASTE_CONTENT_LENGTH } from '../../utils/validation';

// Cap the request body size for this route (content is validated again per-request).
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    try {
        if (req.method === 'POST') {
            const { content, name, permanent: bodyPermanent } = req.body || {};
            if (typeof content !== 'string' || !content) {
                return res.status(400).json({ message: 'Content is required' });
            }
            if (content.length > MAX_PASTE_CONTENT_LENGTH) {
                return res.status(413).json({ message: 'Paste content is too large' });
            }

            const isLoggedIn = !!getSessionFromRequest(req);
            const permanent = isLoggedIn && bodyPermanent !== false && bodyPermanent !== 'false';

            if (permanent && (typeof name !== 'string' || !name.trim())) {
                return res.status(400).json({ message: 'Name is required for permanent pastes.' });
            }

            const id = uuidv4();
            const pasteName = name && typeof name === 'string' ? name : '';
            await savePaste(id, content, pasteName, permanent);
            // Try to update in-memory cache quickly to reflect the new paste instantly.
            try {
                addPasteToCache({
                    id,
                    content,
                    name: pasteName || '',
                    permanent: permanent ? true : false,
                    createdAt: new Date().toISOString(),
                });
            } catch (err) {
                // fallback to full invalidation if update fails
                try {
                    invalidateCache();
                } catch (err2) {}
            }
            return res.status(201).json({ id });
        } else if (req.method === 'GET') {
            const { id } = req.query;
            if (!isValidPasteId(id)) {
                return res.status(400).json({ message: 'Invalid ID' });
            }

            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ message: 'Paste not found' });
            }

            const permanent = paste.permanent === 'true' || paste.permanent === true;
            return res.status(200).json({ id, content: paste.content, name: paste.name ?? '', permanent });
        } else {
            res.setHeader('Allow', ['POST', 'GET']);
            return res.status(405).end(`Method ${req.method} Not Allowed`);
        }
    } catch (error) {
        console.error('/api/paste error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
