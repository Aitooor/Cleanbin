import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../utils/auth';
import {
    createUser,
    listUsers,
    PASSWORD_MIN_LENGTH,
    UserExistsError,
    UserValidationError,
    type UserRole,
} from '../../../utils/users';

// Cap the request body size for this route.
export const config = {
    api: {
        bodyParser: {
            sizeLimit: '1mb',
        },
    },
};

const EMAIL_PATTERN = /^\S+@\S+\.\S+$/;

function parseRole(value: unknown): UserRole | null {
    return value === 'admin' || value === 'user' ? value : null;
}

function parseLimit(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (!requireAdmin(req, res)) return;

    try {
        if (req.method === 'GET') {
            return res.status(200).json(await listUsers());
        }

        if (req.method === 'POST') {
            const { email, password, role, permanentDeleteLimit } = req.body || {};

            if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
                return res.status(400).json({ message: 'A valid email is required' });
            }
            if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
                return res
                    .status(400)
                    .json({ message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
            }
            const parsedRole = parseRole(role);
            if (!parsedRole) {
                return res.status(400).json({ message: 'Role must be "admin" or "user"' });
            }
            const parsedLimit = permanentDeleteLimit === undefined ? 0 : parseLimit(permanentDeleteLimit);
            if (parsedLimit === null) {
                return res
                    .status(400)
                    .json({ message: 'permanentDeleteLimit must be an integer greater than or equal to 0' });
            }

            try {
                const created = await createUser({
                    email,
                    password,
                    role: parsedRole,
                    permanentDeleteLimit: parsedLimit,
                });
                return res.status(201).json(created);
            } catch (error) {
                if (error instanceof UserExistsError) {
                    return res.status(409).json({ message: error.message });
                }
                if (error instanceof UserValidationError) {
                    return res.status(400).json({ message: error.message });
                }
                throw error;
            }
        }

        res.setHeader('Allow', ['GET', 'POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    } catch (error) {
        console.error('/api/users error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
