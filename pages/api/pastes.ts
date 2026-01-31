import { NextApiRequest, NextApiResponse } from 'next';
import { parse } from 'cookie';
import { getAllPastes, savePaste, deleteExpiredPastes } from '../../utils/db';
import config from '../../utils/config';

type Paste = { id: string; content: string; name?: string; permanent?: any; createdAt: string; expiresAt?: string };

// Simple in-process cache for the /api/pastes response (keeps copies decompressed)
let cached: { ts: number; data: Paste[] } | null = null;
const CACHE_TTL_MS = (config.cache.ttl || 3600) * 1000;

async function refreshCache() {
  await deleteExpiredPastes();
  const all = await getAllPastes();
  const normalized = all.map((p: any) => ({ ...p, permanent: p.permanent === 'true' }));
  cached = { ts: Date.now(), data: normalized };
  return normalized;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const force = req.query.force === '1';
      if (!cached || Date.now() - cached.ts > CACHE_TTL_MS || force) {
        await refreshCache();
      }

      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      const start = (page - 1) * limit;
      const items = cached!.data.slice(start, start + limit);

      // Set caching headers for clients (short), server uses in-memory cache for heavy loads
      res.setHeader('Cache-Control', `public, max-age=${Math.min(60, Math.floor(CACHE_TTL_MS / 1000))}`);
      res.status(200).json({ total: cached!.data.length, page, limit, items });
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
      cached = null;
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
