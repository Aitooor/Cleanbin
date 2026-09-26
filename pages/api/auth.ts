import type { NextApiRequest, NextApiResponse } from 'next';
import { serialize } from 'cookie';
import {
  authenticateCredentials,
  createSessionToken,
  getSessionFromRequest,
  SESSION_COOKIE_NAME,
  SESSION_MAX_AGE_SECONDS,
} from '../../utils/auth';

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

      const auth = await authenticateCredentials(email, password);
      if (!auth) {
        return res.status(401).json({ message: 'Invalid credentials' });
      }

      const token = createSessionToken(auth.email, auth.role);
      res.setHeader(
        'Set-Cookie',
        serialize(SESSION_COOKIE_NAME, token, {
          httpOnly: true,
          secure: true,
          sameSite: 'lax',
          path: '/',
          maxAge: SESSION_MAX_AGE_SECONDS,
        })
      );
      return res.status(200).json({ message: 'Login successful' });
    }

    res.setHeader('Allow', ['GET', 'POST']);
    return res.status(405).end(`Method ${req.method} Not Allowed`);
  } catch (error) {
    console.error('POST /api/auth error:', error);
    return res.status(500).json({ message: 'Authentication failed' });
  }
}
