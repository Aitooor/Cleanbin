import { NextApiRequest, NextApiResponse } from 'next';
import { parse } from 'cookie';
import { savePaste, getPastes, deletePaste, getAllPastes } from '../../utils/db';
import { getPage, invalidateCache, startPrecache } from '../../utils/pastesCache';
import config from '../../utils/config';
import { removePasteFromCache } from '../../utils/pastesCache';
import { postMessage } from '../../utils/broadcast';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    try {
      const force = req.query.force === '1';
      const page = Math.max(1, parseInt((req.query.page as string) || '1', 10));
      const limit = Math.min(1000, Math.max(1, parseInt((req.query.limit as string) || '50', 10)));
      // If client provided a token (Cassandra), bypass cached pages and use DB directly
      const token = (req.query.token as string) || undefined;
      if (token) {
        const result = await getPastes(page, limit, token);
        res.setHeader('Cache-Control', `public, max-age=5`);
        return res.status(200).json({ total: result.total, page, limit, items: result.items, nextPageToken: result.nextPageToken || null });
      }
      const result = await getPage(page, limit, force);
      // Prevent client-side caching so dashboard always fetches fresh data immediately.
      // Server still uses in-memory cache for efficiency, but clients should not reuse older responses.
      res.setHeader('Cache-Control', 'no-store');
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
  if (req.method === 'DELETE') {
    try {
      // Accept JSON body with { type: 'all'|'permanent'|'temporary', ids?: string[], filter?: string }
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
      const type = (req.query.type as string) || body.type || 'all';
      const ids: string[] | undefined = body.ids;
      const filter: string | undefined = body.filter;

      // Determine which ids to delete
      let toDeleteIds: string[] = [];
      if (Array.isArray(ids) && ids.length > 0) {
        toDeleteIds = ids;
      } else {
        // fetch all pastes and filter server-side
        const all = await getAllPastes().catch(() => null);
        if (!all) {
          return res.status(500).json({ message: 'Failed to load pastes for deletion' });
        }
        if (type === 'permanent') {
          toDeleteIds = all.filter((p: any) => String(p.permanent) === 'true' || p.permanent === true).map((p: any) => p.id);
        } else if (type === 'temporary' || type === 'temp') {
          toDeleteIds = all.filter((p: any) => !(String(p.permanent) === 'true' || p.permanent === true)).map((p: any) => p.id);
        } else {
          // all or other
          toDeleteIds = all.map((p: any) => p.id);
        }
        // advanced filter: either simple `filter`+`filterField` or structured `filterRules` with `matchMode`
        const filterRules: any[] | undefined = Array.isArray(body.filterRules) ? body.filterRules : undefined;
        const matchMode = (body.matchMode || (req.query.matchMode as string) || 'AND').toUpperCase();
        if (filterRules && filterRules.length > 0) {
          const applyRule = (r: any, item: any) => {
            const val = ('' + (r.value || '')).toLowerCase();
            const fieldVal =
              r.field === 'name' ? (item.name || '') : r.field === 'content' ? (item.content || '') : r.field === 'id' ? (item.id || '') : (item.name || '') + ' ' + (item.content || '') + ' ' + (item.id || '');
            const fv = ('' + fieldVal).toLowerCase();
            let matched = false;
            if (r.op === 'contains') matched = fv.includes(val);
            else if (r.op === 'exact') matched = fv === val;
            else if (r.op === 'starts') matched = fv.startsWith(val);
            else if (r.op === 'regex') {
              try {
                const re = new RegExp(r.value, 'i');
                matched = re.test(fieldVal);
              } catch (e) {
                matched = false;
              }
            }
            return r.negate ? !matched : matched;
          };
          const filtered = all.filter((item) => {
            const results = filterRules.map((r) => applyRule(r, item));
            if (matchMode === 'OR') return results.some(Boolean);
            return results.every(Boolean);
          }).map((p: any) => p.id);
          // intersect with base toDeleteIds (respect type)
          const baseSet = new Set(toDeleteIds);
          toDeleteIds = filtered.filter((id) => baseSet.has(id));
        } else if (filter && filter.trim()) {
          const q = filter.toLowerCase();
          const field = (body.filterField as string) || (req.query.filterField as string) || 'all';
          if (field === 'name') {
            toDeleteIds = all.filter((p: any) => (p.name || '').toLowerCase().includes(q)).map((p: any) => p.id);
          } else if (field === 'content') {
            toDeleteIds = all.filter((p: any) => (p.content || '').toLowerCase().includes(q)).map((p: any) => p.id);
          } else if (field === 'id') {
            toDeleteIds = all.filter((p: any) => (p.id || '').toLowerCase().includes(q)).map((p: any) => p.id);
          } else {
            toDeleteIds = all
              .filter((p: any) => (p.name || '').toLowerCase().includes(q) || (p.content || '').toLowerCase().includes(q) || (p.id || '').toLowerCase().includes(q))
              .map((p: any) => p.id);
          }
        }
      }

      // perform deletions
      const deleted: string[] = [];
      for (const id of toDeleteIds) {
        try {
          await deletePaste(id);
          deleted.push(id);
          try {
            removePasteFromCache(id);
          } catch (e) {}
        } catch (err) {
          // continue on error
        }
      }

      // ensure cache consistency
      try {
        invalidateCache();
      } catch (e) {}

      // broadcast bulk deletion
      try {
        postMessage({ type: 'pastes_bulk_deleted', ids: deleted });
      } catch (e) {}

      return res.status(200).json({ deleted: deleted.length, ids: deleted });
    } catch (err) {
      console.error('DELETE /api/pastes error:', err);
      return res.status(500).json({ message: 'Failed to delete pastes' });
    }
  }

  res.setHeader('Allow', ['GET', 'POST']);
  res.status(405).end(`Method ${req.method} Not Allowed`);
}
