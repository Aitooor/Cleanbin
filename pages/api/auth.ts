import type { NextApiRequest, NextApiResponse } from 'next';
import { getAdmins } from '../../utils/auth';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'POST') {
    const { email, password } = req.body;

    // Check credentials from .env
    if (
      email === process.env.ADMIN_EMAIL &&
      password === process.env.ADMIN_PASSWORD
    ) {
      return res.status(200).json({ message: 'Login successful' });
    }

    // Check credentials from admin list
    const admins = await getAdmins();
    interface Admin {
      email: string;
      password: string;
    }

    const admin = admins.find(
      (admin: Admin) => admin.email === email && admin.password === password
    );

    if (admin) {
      return res.status(200).json({ message: 'Login successful' });
    }

    return res.status(401).json({ message: 'Invalid credentials' });
  } else {
    res.setHeader('Allow', ['POST']);
    res.status(405).end(`Method ${req.method} Not Allowed`);
  }
}