import type { NextApiRequest, NextApiResponse } from 'next';
import {
  authenticateCredentials,
  createAuthChallenge,
  getSessionFromRequest,
} from '../../utils/auth';
import { hasPasskey } from '../../utils/passkeys';
import { getAccountState } from '../../utils/users';

// Cap the request body size for this route.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method === 'GET') {
      const session = getSessionFromRequest(req);
      return res.status(200).json({
        authenticated: !!session,
        email: session?.email ?? null,
        role: session?.role ?? null,
      });
    }

    if (req.method === 'POST') {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string') {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // A passkey registered for this account becomes its only way in, by design.
      // Other accounts keep using passwords.
      if (await hasPasskey(email)) {
        return res.status(403).json({
          message:
            'Password login is disabled because a passkey is registered. Use the passkey or remove it from the dashboard.',
        });
      }

      // Invited accounts have no password yet: never verify credentials for them,
      // just point their owner to the setup link.
      const account = await getAccountState(email);
      if (account?.status === 'invited') {
        return res.status(403).json({
          message: 'This account is pending activation. Finish the invitation from the setup link.',
        });
      }

      const auth = await authenticateCredentials(email, password);
      if (!auth) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      // Password alone never yields a session: it always demands the second
      // factor. Accounts without 2FA are forced to configure it first.
      if (account?.totpEnabled) {
        return res.status(200).json({
          totpRequired: true,
          challenge: createAuthChallenge(auth.email, 'totp'),
        });
      }

      return res.status(200).json({
        setupRequired: true,
        challenge: createAuthChallenge(auth.email, 'setup'),
      });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    console.error('POST /api/auth error:', error);
    return res.status(500).json({ message: 'Authentication failed' });
  }
}
