import { NextApiRequest, NextApiResponse } from 'next';
import { v4 as uuidv4 } from 'uuid';
import { savePaste, getPaste } from '../../utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'POST') {
        const { content, name } = req.body;
        if (!content) {
            return res.status(400).json({ message: 'Content is required' });
        }

        const authToken = req.cookies['auth-token']; // Check the auth-token cookie
        const permanent = authToken === 'true'; // Determine if the paste is permanent

        const id = uuidv4();
        await savePaste(id, content, name, permanent);
        return res.status(201).json({ id });
    } else if (req.method === 'GET') {
        const { id } = req.query;
        if (typeof id !== 'string') {
            return res.status(400).json({ message: 'Invalid ID' });
        }

        const paste = await getPaste(id);
        if (!paste) {
            return res.status(404).json({ message: 'Paste not found' });
        }

        const permanent = paste.permanent === 'true' || paste.permanent === true;
        return res.status(200).json({ id, content: paste.content, name: paste.name, permanent });
    } else {
        res.setHeader('Allow', ['POST', 'GET']);
        return res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}