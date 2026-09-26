import { NextApiRequest, NextApiResponse } from 'next';
import { deletePaste, getPaste, updatePaste } from '../../../utils/db';
import { invalidateCache, removePasteFromCache, updatePasteInCache } from '../../../utils/pastesCache';
import { getSessionFromRequest, requireSession } from '../../../utils/auth';
import { canEdit, getOwner, getSharedWith } from '../../../utils/pasteAccess';
import { postMessage } from '../../../utils/broadcast';
import { isValidPasteId, MAX_PASTE_CONTENT_LENGTH } from '../../../utils/validation';

// Cap the request body size for this route (name + content payloads).
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
            const session = getSessionFromRequest(req);
            return res.status(200).json({
                content: paste.content,
                name: paste.name ?? '',
                permanent,
                expiresAt,
                owner: getOwner(paste),
                sharedWith: getSharedWith(paste),
                canEdit: canEdit(paste, session),
                version: typeof paste.version === 'number' ? paste.version : 0,
                updatedAt: paste.updatedAt ?? paste.createdAt ?? null,
            });
        }

        if (req.method === 'DELETE') {
            const session = requireSession(req, res);
            if (!session) return;

            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ message: 'Paste not found' });
            }
            if (!canEdit(paste, session)) {
                return res.status(403).json({ error: 'You do not have access to this paste' });
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
            try {
                postMessage({ type: 'paste_deleted', id });
            } catch (e) {}
            return res.status(200).json({ success: true });
        }

        if (req.method === 'PATCH') {
            const session = requireSession(req, res);
            if (!session) return;

            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ message: 'Paste not found' });
            }
            if (!canEdit(paste, session)) {
                return res.status(403).json({ error: 'You do not have access to this paste' });
            }

            const { name, content, version } = req.body || {};
            const patch: { name?: string; content?: string; expectedVersion?: number } = {};

            if (name !== undefined) {
                if (typeof name !== 'string' || name.trim().length === 0) {
                    return res.status(400).json({ message: 'Invalid name' });
                }
                patch.name = name.trim();
            }
            if (content !== undefined) {
                if (typeof content !== 'string') {
                    return res.status(400).json({ message: 'Invalid content' });
                }
                if (content.length > MAX_PASTE_CONTENT_LENGTH) {
                    return res.status(413).json({ message: 'Paste content is too large' });
                }
                patch.content = content;
            }
            if (version !== undefined) {
                if (!Number.isInteger(version) || version < 0) {
                    return res.status(400).json({ message: 'Invalid version' });
                }
                patch.expectedVersion = version;
            }
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({ message: 'No changes provided' });
            }

            const result = await updatePaste(id, patch);

            if (result.status === 'not_found') {
                return res.status(404).json({ message: 'Paste not found' });
            }
            if (result.status === 'conflict') {
                // Someone else saved after this client loaded the paste. Return
                // the current server state so the UI can offer to reload it.
                return res.status(409).json({
                    error: 'This paste was changed by someone else while you were editing it.',
                    paste: {
                        id,
                        name: result.paste.name ?? '',
                        content: result.paste.content,
                        version: typeof result.paste.version === 'number' ? result.paste.version : 0,
                        updatedAt: result.paste.updatedAt ?? null,
                    },
                });
            }

            const updated = result.paste;
            // Keep the in-memory listing cache coherent without a full refresh.
            try {
                updatePasteInCache(id, {
                    name: updated.name,
                    content: updated.content,
                    owner: getOwner(updated),
                    sharedWith: getSharedWith(updated),
                    version: updated.version,
                    updatedAt: updated.updatedAt,
                });
            } catch (err) {
                try {
                    invalidateCache();
                } catch (e) {}
            }
            try {
                postMessage({ type: 'paste_updated', id });
            } catch (e) {}

            return res.status(200).json({
                success: true,
                paste: {
                    id,
                    name: updated.name ?? '',
                    content: updated.content,
                    owner: getOwner(updated),
                    sharedWith: getSharedWith(updated),
                    version: typeof updated.version === 'number' ? updated.version : 0,
                    updatedAt: updated.updatedAt ?? null,
                },
            });
        }

        res.setHeader('Allow', ['GET', 'DELETE', 'PATCH']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    } catch (error) {
        console.error('/api/paste/[id] error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
