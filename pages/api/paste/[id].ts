import { NextApiRequest, NextApiResponse } from 'next';
import { deletePaste, getPaste } from '../../../utils/db';

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

    res.setHeader('Allow', ['GET', 'DELETE']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
}
