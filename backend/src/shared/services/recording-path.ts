export interface RecordingPathConfig {
  remote_root: string;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}

export function resolveRemoteRecordingPath(cfg: RecordingPathConfig, storedPath: string): string {
  const raw = normalizePath(storedPath || '');
  if (!raw || raw.includes('..')) throw new Error('invalid recording path');
  const root = normalizePath(cfg.remote_root || '').replace(/\/$/, '');
  if (raw.startsWith('/')) {
    if (!root || raw.startsWith(`${root}/`) || raw === root) return raw;
    const base = raw.split('/').pop() || raw;
    return `${root}/smc_icc_record/${base}`;
  }
  return root ? `${root}/${raw.replace(/^\//, '')}` : raw;
}
