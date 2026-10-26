import { readFileSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import { defaultHubConfig } from './defaults.js';
import { hubConfigSchema, type HubConfig } from './schema.js';
import { parseRestrictedYaml } from './yaml.js';

function deepMerge<T extends Record<string, unknown>>(base: T, overlay: Record<string, unknown> | undefined): T {
  if (!overlay) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(overlay)) {
    if (v === undefined) continue;
    const prev = out[k];
    if (
      v && typeof v === 'object' && !Array.isArray(v) &&
      prev && typeof prev === 'object' && !Array.isArray(prev)
    ) {
      out[k] = deepMerge(prev as Record<string, unknown>, v as Record<string, unknown>);
    } else {
      out[k] = v;
    }
  }
  return out as T;
}

function envOverlays(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const overlay: Record<string, unknown> = {};
  if (env.HUB_ENABLED !== undefined) overlay.enabled = env.HUB_ENABLED;
  if (env.HUB_ROLE) overlay.role = env.HUB_ROLE;
  if (env.HUB_SINKS_DISABLED) {
    overlay.sinksDisabled = env.HUB_SINKS_DISABLED.split(',').map((s) => s.trim()).filter(Boolean);
  }
  if (env.HUB_INGEST_MODE) {
    overlay.ingest = { mode: env.HUB_INGEST_MODE };
  }
  if (env.HUB_INGEST !== undefined) overlay.runIngest = env.HUB_INGEST;
  const vdnRaw = env.HUB_RECONCILE_VDNS || env.HUB_TEST_VDN;
  if (vdnRaw) {
    const vdnIds = vdnRaw.split(/[,;\s]+/).map((s) => Number(s.trim())).filter((n) => Number.isInteger(n));
    overlay.reconcile = { vdnIds };
  }
  return overlay;
}

function loadFileConfig(path: string, env: NodeJS.ProcessEnv): Record<string, unknown> {
  const abs = isAbsolute(path) ? path : resolve(process.cwd(), path);
  const raw = readFileSync(abs, 'utf8');
  if (abs.endsWith('.json')) return JSON.parse(raw) as Record<string, unknown>;
  const parsed = parseRestrictedYaml(raw, env);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Hub 配置文件不是对象: ${abs}`);
  }
  return parsed as Record<string, unknown>;
}

export function loadHubConfig(env: NodeJS.ProcessEnv = process.env): HubConfig {
  let merged: Record<string, unknown> = { ...defaultHubConfig } as Record<string, unknown>;
  const filePath = env.HUB_CONFIG_PATH?.trim();
  if (filePath) {
    try {
      merged = deepMerge(merged, loadFileConfig(filePath, env));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`无法加载 HUB_CONFIG_PATH=${filePath}: ${msg}`);
    }
  }
  merged = deepMerge(merged, envOverlays(env));
  const parsed = hubConfigSchema.safeParse(merged);
  if (!parsed.success) {
    const details = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
    throw new Error(`Hub 配置无效: ${details}`);
  }
  return parsed.data;
}
