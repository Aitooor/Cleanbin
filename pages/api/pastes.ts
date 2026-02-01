import { NextApiRequest, NextApiResponse } from 'next';
import { parse } from 'cookie';
import { savePaste } from '../../utils/db';
import { getPage, invalidateCache, startPrecache } from '../../utils/pastesCache';
import config from '../../utils/config';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const force = req.query.force === '1';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const result = await getPage(page, limit, force);
      // Set caching headers for clients (short), server uses in-memory cache for heavy loads
      res.setHeader('Cache-Control', `public, max-age=${Math.min(60, Math.floor((config.cache.ttl || 3600)))}`);
      res.status(200).json({ total: result.total, page, limit, items: result.items });
    } catch (error) {
      console.error('GET /api/pastes error:', error);
      res.status(500).json({ message: 'Failed to fetch pastes' });
    }
    return;
  }
  if (req.method === 'POST') {
    const { id, content, name } = req.body;
    const cookies = parse(req.headers.cookie || '');
    const isLoggedIn = cookies['auth-token'] === 'true';

    if (isLoggedIn && !name) {
      return res.status(400).json({ message: 'Name is required for permanent pastes.' });
    }

    const permanent = isLoggedIn ? 'true' : 'false';
    try {
      await savePaste(id, content, name, permanent === 'true');
      // Invalidate cache immediately so dashboard sees new paste
      invalidateCache();
      res.status(201).json({ message: 'Paste created' });
    } catch (error) {
      console.error('POST /api/pastes error:', error);
      res.status(500).json({ message: 'Failed to create paste' });
    }
    return;
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
