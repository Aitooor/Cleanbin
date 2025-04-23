let fs: typeof import('fs/promises');
let path: typeof import('path');

if (typeof window === 'undefined') {
  // Dynamically import Node.js modules only on the server side
  fs = require('fs/promises');
  path = require('path');
}

const JSON_DB_PATH = process.env.JSON_DB_PATH || './data/pastes/';
const CACHE_TTL = parseInt(process.env.CACHE_TTL || '3600', 10) * 1000; // Convert to milliseconds

// In-memory cache
const cache = new Map();

interface CacheEntry {
  data: Paste;
  timestamp: number;
}

interface Paste {
  id: string;
  content: string;
  name: string;
  permanent: boolean; // Nuevo campo para distinguir entre permanente y temporal
  createdAt: string;
  expiresAt?: string; // Fecha de expiración para pastes temporales
}

function getCacheKey(id: string): string {
  return `paste_${id}`;
}

function isCacheValid(timestamp: number): boolean {
  return Date.now() - timestamp < CACHE_TTL;
}

export async function savePaste(
  id: string,
  content: string,
  name: string,
  permanent: boolean
): Promise<string> {
  const filePath = path.join(JSON_DB_PATH, `${id}.json`);
  const data = {
    id,
    content,
    name, // Aseguramos que el nombre proporcionado se guarde correctamente
    permanent: permanent ? "true" : "false",
    createdAt: new Date().toISOString(),
  };

  await fs.mkdir(JSON_DB_PATH, { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(data, null, 2)); // Guardar el JSON con el campo `name`
  cache.set(getCacheKey(id), { data, timestamp: Date.now() });
  return id;
}

export async function getPaste(id: string): Promise<Paste | null> {
  if (!fs || !path) throw new Error('This function can only be used on the server side.');

  const cacheKey: string = getCacheKey(id);

  // Check cache
  if (cache.has(cacheKey)) {
    const cached: CacheEntry | undefined = cache.get(cacheKey);
    if (cached && isCacheValid(cached.timestamp)) {
      return cached.data;
    }
    cache.delete(cacheKey); // Remove expired cache
  }

  // Read from file
  const filePath: string = path.join(JSON_DB_PATH, `${id}.json`);
  try {
    const fileContent: string = await fs.readFile(filePath, 'utf-8');
    const data: Paste = JSON.parse(fileContent);
    // Update cache
    cache.set(cacheKey, { data, timestamp: Date.now() });
    return data;
  } catch (error: any) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null; // File not found
    }
    throw error;
  }
}

export async function deletePaste(id: string): Promise<void> {
  if (!fs || !path) throw new Error('This function can only be used on the server side.');

  const filePath: string = path.join(JSON_DB_PATH, `${id}.json`);

  // Delete from file
  await fs.unlink(filePath).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error; // Ignore if file doesn't exist
  });

  // Delete from cache
  cache.delete(getCacheKey(id));
}

export async function deleteExpiredPastes(): Promise<void> {
  if (!fs || !path) throw new Error('This function can only be used on the server side.');

  const files = await fs.readdir(JSON_DB_PATH);
  for (const file of files) {
    if (file.endsWith('.json')) {
      const filePath = path.join(JSON_DB_PATH, file);
      const fileContent = await fs.readFile(filePath, 'utf-8');
      const paste: Paste = JSON.parse(fileContent);

      if (paste.expiresAt && new Date() > new Date(paste.expiresAt)) {
        await fs.unlink(filePath);
        cache.delete(getCacheKey(paste.id));
      }
    }
  }
}

export async function getAllPastes() {
  if (!fs || !path) throw new Error('This function can only be used on the server side.');

  try {
    const files = await fs.readdir(JSON_DB_PATH);
    const pastes = [];
    for (const file of files) {
      if (file.endsWith('.json')) {
        const filePath = path.join(JSON_DB_PATH, file);
        const fileContent = await fs.readFile(filePath, 'utf-8');
        pastes.push(JSON.parse(fileContent));
      }
    }
    return pastes;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return []; // Directory not found
    }
    throw error;
  }
}

export async function fetchPastes() {
  return await getAllPastes();
}