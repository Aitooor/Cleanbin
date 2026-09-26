import type { NextApiRequest, NextApiResponse } from 'next';
import { setSessionCookie, verifyAuthChallenge } from '../../../utils/auth';
import { enableTotp, resolveInviteEmail } from '../../../utils/users';

// Finishes the setup: verifies the TOTP code against the pending secret,
// activates 2FA and the account, burns the invitation, and issues a session.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { token, challenge, code } = req.body || {};
        if (typeof code !== 'string') {
            return res.status(400).json({ message: 'A verification code is required' });
        }

        let email: string | null = null;
        if (typeof token === 'string' && token) {
            email = await resolveInviteEmail(token);
            if (!email) {
                return res.status(410).json({ message: 'This invitation is invalid or has expired' });
            }
        } else if (typeof challenge === 'string' && challenge) {
            const payload = verifyAuthChallenge(challenge, 'setup');
            if (!payload) {
                return res.status(400).json({ message: 'This setup session has expired. Sign in again.' });
            }
            email = payload.email;
        } else {
            return res.status(400).json({ message: 'A token or challenge is required' });
        }

        const state = await enableTotp(email, code);
        if (!state) {
            return res.status(401).json({ message: 'Invalid verification code' });
        }

        setSessionCookie(res, state.email, state.role);
        return res.status(200).json({
            message: 'Two-factor authentication enabled',
            email: state.email,
            role: state.role,
        });
    } catch (error) {
        console.error('POST /api/setup/complete error:', error);
        return res.status(500).json({ message: 'Could not complete the setup' });
    }
}
