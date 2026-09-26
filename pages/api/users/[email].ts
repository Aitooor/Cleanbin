import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAdmin } from '../../../utils/auth';
import {
    deleteUser,
    updateUser,
    issueInviteToken,
    disableTotp,
    ImmutableUserError,
    PASSWORD_MIN_LENGTH,
    UserNotFoundError,
    UserValidationError,
    type UpdateUserPatch,
    type UserRole,
} from '../../../utils/users';
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

function firstQueryValue(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function parseRole(value: unknown): UserRole | null {
    return value === 'admin' || value === 'user' ? value : null;
}

function parseLimit(value: unknown): number | null {
    const parsed = typeof value === 'number' ? value : Number(value);
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

function sendUserError(res: NextApiResponse, error: unknown): boolean {
    if (error instanceof ImmutableUserError) {
        res.status(403).json({ message: error.message });
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
    if (!requireAdmin(req, res)) return;

    const email = firstQueryValue(req.query.email).trim();
    if (!email) {
        return res.status(400).json({ message: 'Email is required' });
    }

    try {
        if (req.method === 'PATCH') {
            const { action, role, permanentDeleteLimit, password } = req.body || {};

            if (action === 'resend-invite') {
                try {
                    const inviteToken = await issueInviteToken(email);
                    const url = buildSetupUrl(inviteToken, resolveOrigin(req));
                    const delivery = await sendInvitationEmail(email, url);
                    // Same fallback as creation: the link is exposed only when
                    // email delivery is unavailable.
                    return res.status(200).json({
                        emailSent: delivery.sent,
                        ...(delivery.sent ? {} : { setupUrl: url }),
                    });
                } catch (error) {
                    if (sendUserError(res, error)) return;
                    throw error;
                }
            }

            if (action === 'reset-2fa') {
                try {
                    await disableTotp(email);
                    return res.status(200).json({ message: 'Two-factor authentication reset' });
                } catch (error) {
                    if (sendUserError(res, error)) return;
                    throw error;
                }
            }

            const patch: UpdateUserPatch = {};

            if (role !== undefined) {
                const parsedRole = parseRole(role);
                if (!parsedRole) {
                    return res.status(400).json({ message: 'Role must be "admin" or "user"' });
                }
                patch.role = parsedRole;
            }
            if (permanentDeleteLimit !== undefined) {
                const parsedLimit = parseLimit(permanentDeleteLimit);
                if (parsedLimit === null) {
                    return res
                        .status(400)
                        .json({ message: 'permanentDeleteLimit must be an integer greater than or equal to 0' });
                }
                patch.permanentDeleteLimit = parsedLimit;
            }
            if (password !== undefined) {
                if (typeof password !== 'string' || password.length < PASSWORD_MIN_LENGTH) {
                    return res
                        .status(400)
                        .json({ message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters` });
                }
                patch.password = password;
            }
            if (Object.keys(patch).length === 0) {
                return res.status(400).json({ message: 'No changes provided' });
            }

            try {
                return res.status(200).json(await updateUser(email, patch));
            } catch (error) {
                if (sendUserError(res, error)) return;
                throw error;
            }
        }

        if (req.method === 'DELETE') {
            try {
                await deleteUser(email);
                return res.status(200).json({ message: 'User deleted' });
            } catch (error) {
                if (sendUserError(res, error)) return;
                throw error;
            }
        }

        res.setHeader('Allow', ['PATCH', 'DELETE']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    } catch (error) {
        console.error('/api/users/[email] error:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
}
