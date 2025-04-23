import { NextApiRequest, NextApiResponse } from 'next';
import { getAdmins, createAdmin, updateAdmin, deleteAdmin } from '../../utils/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        const admins = await getAdmins();
        return res.status(200).json(admins);
    } else if (req.method === 'POST') {
        const { email, password } = req.body;
        try {
            await createAdmin(email, password);
            return res.status(201).json({ message: 'Admin created' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            return res.status(400).json({ message: errorMessage });
        }
    } else if (req.method === 'PUT') {
        const { email } = req.query;
        const { password } = req.body;
        try {
            await updateAdmin(email as string, password);
            return res.status(200).json({ message: 'Admin updated' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            return res.status(400).json({ message: errorMessage });
        }
    } else if (req.method === 'DELETE') {
        const { email } = req.query;
        try {
            await deleteAdmin(email as string);
            return res.status(200).json({ message: 'Admin deleted' });
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
            return res.status(400).json({ message: errorMessage });
        }
    } else {
        return res.status(405).json({ message: 'Method not allowed' });
    }
}
