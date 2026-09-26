import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyAuthChallenge } from '../../../utils/auth';
import {
    resolveInviteEmail,
    setUserPassword,
    startTotpSetup,
    SETUP_PASSWORD_MIN_LENGTH,
    UserNotFoundError,
    UserValidationError,
} from '../../../utils/users';
import { buildOtpAuthUrl, groupSecret } from '../../../utils/totp';

// Starts the TOTP configuration. Accepts either a single-use invitation token
// (which also sets the account password) or a signed setup challenge issued
// after a password login. Returns the pending secret to its own owner only.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { token, challenge, password } = req.body || {};
        let email: string | null = null;

        if (typeof token === 'string' && token) {
            email = await resolveInviteEmail(token);
            if (!email) {
                return res.status(410).json({ message: 'This invitation is invalid or has expired' });
            }
            if (typeof password !== 'string' || password.length < SETUP_PASSWORD_MIN_LENGTH) {
                return res.status(400).json({
                    message: `Password must be at least ${SETUP_PASSWORD_MIN_LENGTH} characters`,
                });
            }
            await setUserPassword(email, password);
        } else if (typeof challenge === 'string' && challenge) {
            const payload = verifyAuthChallenge(challenge, 'setup');
            if (!payload) {
                return res.status(400).json({ message: 'This setup session has expired. Sign in again.' });
            }
            email = payload.email;
        } else {
            return res.status(400).json({ message: 'A token or challenge is required' });
        }

        const secret = await startTotpSetup(email);
        return res.status(200).json({
            email,
            secret,
            groupedSecret: groupSecret(secret),
            otpauthUrl: buildOtpAuthUrl(email, secret),
        });
    } catch (error) {
        if (error instanceof UserValidationError) {
            return res.status(400).json({ message: error.message });
        }
        if (error instanceof UserNotFoundError) {
            return res.status(404).json({ message: error.message });
        }
        console.error('POST /api/setup/start error:', error);
        return res.status(500).json({ message: 'Could not start the setup' });
    }
}
