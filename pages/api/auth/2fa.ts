import type { NextApiRequest, NextApiResponse } from 'next';
import { setSessionCookie, verifyAuthChallenge } from '../../../utils/auth';
import { getAccountState, getEnabledTotpSecret } from '../../../utils/users';
import { verifyTotp } from '../../../utils/totp';

// Second step of a password login: exchange the short-lived signed challenge
// plus a valid TOTP code for a session cookie. A bad code never sets a cookie.
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
    if (req.method !== 'POST') {
        res.setHeader('Allow', ['POST']);
        return res.status(405).json({ message: `Method ${req.method} Not Allowed` });
    }

    try {
        const { challenge, code } = req.body || {};
        if (typeof challenge !== 'string' || typeof code !== 'string') {
            return res.status(400).json({ message: 'Challenge and code are required' });
        }

        const payload = verifyAuthChallenge(challenge, 'totp');
        if (!payload) {
            return res.status(400).json({ message: 'This challenge has expired. Sign in again.' });
        }

        const secret = await getEnabledTotpSecret(payload.email);
        if (!secret || !verifyTotp(secret, code)) {
            return res.status(401).json({ message: 'Invalid verification code' });
        }

        const account = await getAccountState(payload.email);
        if (!account) {
            return res.status(401).json({ message: 'Invalid verification code' });
        }

        setSessionCookie(res, account.email, account.role);
        return res.status(200).json({ message: 'Login successful', email: account.email, role: account.role });
    } catch (error) {
        console.error('POST /api/auth/2fa error:', error);
        return res.status(500).json({ message: 'Authentication failed' });
    }
}
