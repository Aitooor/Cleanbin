import { NextApiRequest, NextApiResponse } from 'next';
import { parse } from 'cookie';
import { getAllPastes, savePaste, deleteExpiredPastes } from '../../utils/db';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method === 'GET') {
        try {
            await deleteExpiredPastes(); // Eliminar pastes temporales expirados
            const pastes = await getAllPastes();
            res.status(200).json(
                pastes.map((paste) => ({
                    ...paste,
                    permanent: paste.permanent === 'true', // Convertir a booleano si es necesario
                }))
            );
        } catch (error) {
            res.status(500).json({ message: 'Failed to fetch pastes' });
        }
    } else if (req.method === 'POST') {
        const { id, content, name } = req.body; // Aseguramos que `name` se extraiga correctamente
        const cookies = parse(req.headers.cookie || '');
        const isLoggedIn = cookies['auth-token'] === 'true';

        if (isLoggedIn && !name) {
            return res.status(400).json({ message: 'Name is required for permanent pastes.' });
        }

        const permanent = isLoggedIn ? "true" : "false"; // Guardar como cadena
        try {
            await savePaste(id, content, name, permanent === "true"); // Pasar `name` correctamente
            res.status(201).json({ message: 'Paste created' });
        } catch (error) {
            res.status(500).json({ message: 'Failed to create paste' });
        }
    } else {
        res.setHeader('Allow', ['GET', 'POST']);
        res.status(405).end(`Method ${req.method} Not Allowed`);
    }
}
