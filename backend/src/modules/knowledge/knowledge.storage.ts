import { mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';
export const originalsRoot = () => path.resolve(process.env.KNOWLEDGE_STORAGE_DIR || './private/knowledge');
export function originalPath(key: string) {
  if (!/^[1-9]\d*\/[1-9]\d*\/[a-f0-9-]{36}$/.test(key)) throw new Error('invalid_original_key');
  return path.join(originalsRoot(), key);
}

export async function writeOriginal(key: string, bytes: Buffer) {
  const target = originalPath(key);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  const handle = await open(`${target}.part`, 'wx', 0o600);
  try { await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  await rename(`${target}.part`, target);
}
