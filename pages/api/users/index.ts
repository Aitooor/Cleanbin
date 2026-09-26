import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../utils/auth';
import {
    createUser,
    listUsers,
    UserExistsError,
    UserValidationError,
    type UserRole,
} from '../../../utils/users';
import { hasPasskey } from '../../../utils/passkeys';
import { resolveOrigin } from '../../../utils/passkeyRequest';
import { buildSetupUrl } from '../../../utils/invites';
import { sendInvitationEmail } from '../../../utils/mailer';

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
    if (!(await requireAdmin(req, res))) return;

    try {
        if (req.method === 'GET') {
            const users = await listUsers();
            const withPasskey = await Promise.all(
                users.map(async (user) => ({
                    ...user,
                    hasPasskey: user.email ? await hasPasskey(user.email) : false,
                }))
            );
            return res.status(200).json(withPasskey);
        }

        if (req.method === 'POST') {
            const { email, role, permanentDeleteLimit } = req.body || {};

            if (typeof email !== 'string' || !EMAIL_PATTERN.test(email.trim())) {
                return res.status(400).json({ message: 'A valid email is required' });
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
                // Accounts are created as invitations: no password is set here.
                const { user, inviteToken } = await createUser({
                    email,
                    role: parsedRole,
                    permanentDeleteLimit: parsedLimit,
                });

                let emailSent = false;
                let setupUrl: string | undefined;
                if (inviteToken) {
                    const url = buildSetupUrl(inviteToken, resolveOrigin(req));
                    const delivery = await sendInvitationEmail(user.email, url);
                    emailSent = delivery.sent;
                    // setupUrl is only returned when email delivery fails, so the
                    // admin can hand the link over out of band. It is never sent
                    // on the happy path, where the token lives only in the email.
                    if (!delivery.sent) setupUrl = url;
                }

                return res.status(201).json({
                    ...user,
                    emailSent,
                    ...(setupUrl ? { setupUrl } : {}),
                });
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
