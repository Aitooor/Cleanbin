import { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../utils/auth';
import {
    createUser,
    deleteUser,
    listUsers,
    updateUser,
    ImmutableUserError,
    UserExistsError,
    UserNotFoundError,
    UserValidationError,
} from '../../utils/users';

// Legacy admin endpoint. It now delegates to the canonical users store
// (utils/users.ts); new integrations should use /api/users instead.
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
};

function sendUserError(res: NextApiResponse, error: unknown): boolean {
    if (error instanceof ImmutableUserError) {
        res.status(403).json({ message: error.message });
        return true;
    }
    if (error instanceof UserExistsError) {
        res.status(409).json({ message: error.message });
        return true;
    }
    if (error instanceof UserNotFoundError) {
        res.status(404).json({ message: error.message });
        return true;
    }
    if (error instanceof UserValidationError) {
        res.status(400).json({ message: error.message });
        return true;
    }
    return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    // Admin management requires a valid session with the admin role, for every method.
    if (!requireAdmin(req, res)) return;

    try {
        if (req.method === 'GET') {
            const admins = (await listUsers()).filter((user) => user.role === 'admin');
            return res.status(200).json(admins);
        }

        if (req.method === 'POST') {
            const { email, password } = req.body || {};
            if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
                return res.status(400).json({ message: 'Email and password are required' });
            }
            try {
                await createUser({ email, password, role: 'admin', permanentDeleteLimit: 0 });
                return res.status(201).json({ message: 'Admin created' });
            } catch (error) {
                if (sendUserError(res, error)) return;
                throw error;
            }
        }

        if (req.method === 'PUT') {
            const { email } = req.query;
            const { password } = req.body || {};
            if (typeof email !== 'string' || typeof password !== 'string' || !password) {
                return res.status(400).json({ message: 'Email and password are required' });
            }
            try {
                await updateUser(email, { password });
                return res.status(200).json({ message: 'Admin updated' });
            } catch (error) {
                if (sendUserError(res, error)) return;
                throw error;
            }
        }

        if (req.method === 'DELETE') {
            const { email } = req.query;
            if (typeof email !== 'string' || !email) {
                return res.status(400).json({ message: 'Email is required' });
            }
            try {
                await deleteUser(email);
                return res.status(200).json({ message: 'Admin deleted' });
            } catch (error) {
                if (sendUserError(res, error)) return;
                throw error;
            }
        }

        return res.status(405).json({ message: 'Method not allowed' });
    } catch (error) {
        console.error('/api/admins error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
