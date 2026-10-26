import { prisma } from './db.js';

/**
 * Reads integration API keys from database (platform_configs table).
 * Falls back to environment variables if not configured in DB.
 * This enables the "平台配置管理 → 对接集成" UI to manage all keys.
 */

let cache: Map<string, string> = new Map();
let lastCacheTime = 0;
const CACHE_TTL_MS = 60_000; // 1 minute

async function refreshCache() {
  if (Date.now() - lastCacheTime < CACHE_TTL_MS) return;
  const configs = await prisma.platform_configs.findMany({
    where: { category: 'integrations' },
    select: { key: true, value: true },
  });
  cache = new Map(configs.map(c => [c.key, c.value]));
  lastCacheTime = Date.now();
}

/**
 * Get an integration key value. Order: DB → env var → empty string.
 */
export async function getConfig(key: string): Promise<string> {
  await refreshCache();
  const dbValue = cache.get(key);
  if (dbValue) return dbValue;
  return process.env[key.toUpperCase()] ?? '';
}

/**
 * Returns true if the given integration key is configured.
 */
export async function hasConfig(key: string): Promise<boolean> {
  const val = await getConfig(key);
  return val.length > 0;
}
