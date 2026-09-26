import { NextApiRequest, NextApiResponse } from 'next';
import { getAdmins, createAdmin, updateAdmin, deleteAdmin, requireAdmin } from '../../utils/auth';

// Cap the request body size for this route.
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '1mb',
    },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Admin management requires a valid session with the admin role, for every method.
  const session = requireAdmin(req, res);
  if (!session) return;

  try {
    if (req.method === 'GET') {
      const admins = await getAdmins();
      return res.status(200).json(admins);
    }

    if (req.method === 'POST') {
      const { email, password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string' || !email || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
      try {
        await createAdmin(email, password);
        return res.status(201).json({ message: 'Admin created' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return res.status(400).json({ message: errorMessage });
      }
    }

    if (req.method === 'PUT') {
      const { email } = req.query;
      const { password } = req.body || {};
      if (typeof email !== 'string' || typeof password !== 'string' || !password) {
        return res.status(400).json({ message: 'Email and password are required' });
      }
      try {
        await updateAdmin(email, password);
        return res.status(200).json({ message: 'Admin updated' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return res.status(400).json({ message: errorMessage });
      }
    }

    if (req.method === 'DELETE') {
      const { email } = req.query;
      if (typeof email !== 'string' || !email) {
        return res.status(400).json({ message: 'Email is required' });
      }
      try {
        await deleteAdmin(email);
        return res.status(200).json({ message: 'Admin deleted' });
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred';
        return res.status(400).json({ message: errorMessage });
      }
    }

    return res.status(405).json({ message: 'Method not allowed' });
  } catch (error) {
    console.error('/api/admins error:', error);
    return res.status(500).json({ message: 'Internal server error' });
  }
}
