import { NextApiRequest, NextApiResponse } from 'next';
import { deletePaste, getPaste, updatePasteName } from '../../../utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    const { id } = req.query;

    if (typeof id !== 'string') {
        return res.status(400).json({ message: 'Invalid ID' });
    }

    if (req.method === 'GET') {
        try {
            const paste = await getPaste(id);
            if (!paste) {
                return res.status(404).json({ error: 'Paste not found' });
            }
            return res.status(200).json({ content: paste.content });
        } catch (error) {
            console.error('Error fetching paste:', error);
            return res.status(500).json({ error: 'Internal Server Error' });
        }
    }

    if (req.method === 'DELETE') {
        const paste = await getPaste(id);
        if (!paste) {
            return res.status(404).json({ message: 'Paste not found' });
        }

        await deletePaste(id);
        return res.status(200).json({ success: true });
    }

    if (req.method === 'PATCH') {
        // Update the paste name
        const { name } = req.body;
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

        return res.status(200).json({ success: true, paste: updated });
    }

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
}
