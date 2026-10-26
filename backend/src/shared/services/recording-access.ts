import { Client } from 'ssh2';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { prisma } from '../../plugins/db.js';
import { parseAgRecordingName, type FsRecordFile } from './recording-match.js';
import { resolveRemoteRecordingPath } from './recording-path.js';

export { resolveRemoteRecordingPath } from './recording-path.js';

export type RecordingSource = 'sftp' | 'local' | 'http';

export interface RecordingAccessConfig {
  source: RecordingSource;
  sftp_host: string;
  sftp_port: number;
  sftp_user: string;
  sftp_password: string;
  remote_root: string;
}

const CONFIG_KEY = 'recording_access';

function fromEnv(): RecordingAccessConfig {
  return {
    source: (process.env.RECORDING_SOURCE as RecordingSource) || 'sftp',
    sftp_host: process.env.RECORDING_SFTP_HOST || '192.168.255.128',
    sftp_port: Number(process.env.RECORDING_SFTP_PORT || 22),
    sftp_user: process.env.RECORDING_SFTP_USER || 'root',
    sftp_password: process.env.RECORDING_SFTP_PASSWORD || '',
    remote_root:
      process.env.RECORDING_SFTP_ROOT
      || '/usr/local/freeswitch-1.10.12/var/lib/freeswitch/recordings',
  };
}

export function maskRecordingAccess(cfg: RecordingAccessConfig) {
  return {
    source: cfg.source,
    sftp_host: cfg.sftp_host,
    sftp_port: cfg.sftp_port,
    sftp_user: cfg.sftp_user,
    sftp_password_set: !!cfg.sftp_password,
    remote_root: cfg.remote_root,
  };
}

export async function getRecordingAccessConfig(): Promise<RecordingAccessConfig> {
  const envCfg = fromEnv();
  const row = await prisma.platform_configs.findUnique({ where: { key: CONFIG_KEY } });
  if (!row?.value) return envCfg;
  try {
    const parsed = JSON.parse(row.value) as Partial<RecordingAccessConfig>;
    return {
      source: parsed.source || envCfg.source,
      sftp_host: parsed.sftp_host || envCfg.sftp_host,
      sftp_port: Number(parsed.sftp_port || envCfg.sftp_port),
      sftp_user: parsed.sftp_user || envCfg.sftp_user,
      sftp_password: parsed.sftp_password || envCfg.sftp_password,
      remote_root: parsed.remote_root || envCfg.remote_root,
    };
  } catch {
    return envCfg;
  }
}

export async function saveRecordingAccessConfig(input: Partial<RecordingAccessConfig>) {
  const current = await getRecordingAccessConfig();
  const next: RecordingAccessConfig = {
    source: input.source || current.source,
    sftp_host: (input.sftp_host ?? current.sftp_host).trim(),
    sftp_port: Number(input.sftp_port ?? current.sftp_port) || 22,
    sftp_user: (input.sftp_user ?? current.sftp_user).trim(),
    sftp_password: input.sftp_password ? String(input.sftp_password) : current.sftp_password,
    remote_root: (input.remote_root ?? current.remote_root).trim(),
  };
  await prisma.platform_configs.upsert({
    where: { key: CONFIG_KEY },
    update: {
      value: JSON.stringify(next),
      category: 'integrations',
      description: 'FS 录音接入（SFTP/本地）',
    },
    create: {
      key: CONFIG_KEY,
      value: JSON.stringify(next),
      category: 'integrations',
      description: 'FS 录音接入（SFTP/本地）',
    },
  });
  return next;
}

function sftpReadFile(cfg: RecordingAccessConfig, remotePath: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('sftp timeout'));
    }, 20000);
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        const chunks: Buffer[] = [];
        const stream = sftp.createReadStream(remotePath);
        stream.on('data', (c: Buffer) => chunks.push(c));
        stream.on('error', (e: Error) => {
          clearTimeout(timer);
          conn.end();
          reject(e);
        });
        stream.on('end', () => {
          clearTimeout(timer);
          conn.end();
          resolve(Buffer.concat(chunks));
        });
      });
    });
    conn.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    conn.connect({
      host: cfg.sftp_host,
      port: cfg.sftp_port,
      username: cfg.sftp_user,
      password: cfg.sftp_password,
      readyTimeout: 12000,
    });
  });
}

function toListedFile(filename: string): FsRecordFile | null {
  const parsed = parseAgRecordingName(filename);
  if (!parsed) return null;
  return {
    relPath: `smc_icc_record/${filename.replace(/\\/g, '/').split('/').pop()}`,
    unixSec: parsed.unixSec,
    recCh: parsed.recCh,
  };
}

let listCache: { at: number; items: FsRecordFile[] } | null = null;
const LIST_TTL_MS = 45_000;

function sftpReadDir(cfg: RecordingAccessConfig, remoteDir: string): Promise<string[]> {
  return new Promise((resolve, reject) => {
    const conn = new Client();
    const timer = setTimeout(() => {
      conn.end();
      reject(new Error('sftp timeout'));
    }, 15000);
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) {
          clearTimeout(timer);
          conn.end();
          reject(err);
          return;
        }
        sftp.readdir(remoteDir, (e, list) => {
          clearTimeout(timer);
          conn.end();
          if (e) {
            reject(e);
            return;
          }
          resolve((list || []).map((it) => it.filename).filter(Boolean));
        });
      });
    });
    conn.on('error', (e: Error) => {
      clearTimeout(timer);
      reject(e);
    });
    conn.connect({
      host: cfg.sftp_host,
      port: cfg.sftp_port,
      username: cfg.sftp_user,
      password: cfg.sftp_password,
      readyTimeout: 12000,
    });
  });
}

/** 列出近期 `smc_icc_record/ag_*_*.wav`，给话单对齐录音用。结果缓存 45 秒。 */
export async function listRecentRecordingFiles(): Promise<FsRecordFile[]> {
  if (listCache && Date.now() - listCache.at < LIST_TTL_MS) return listCache.items;
  const cfg = await getRecordingAccessConfig();
  const remoteDir = `${(cfg.remote_root || '').replace(/\/$/, '')}/smc_icc_record`;
  try {
    let names: string[] = [];
    if (cfg.source === 'local') {
      names = await readdir(remoteDir);
    } else if (cfg.source === 'sftp') {
      if (!cfg.sftp_host || !cfg.sftp_user || !cfg.sftp_password) return [];
      names = await sftpReadDir(cfg, remoteDir);
    }
    const items = names
      .map(toListedFile)
      .filter((x): x is FsRecordFile => !!x)
      .sort((a, b) => b.unixSec - a.unixSec)
      .slice(0, 400);
    listCache = { at: Date.now(), items };
    return items;
  } catch (e) {
    console.error('[recording-access] list recordings failed', e);
    listCache = { at: Date.now() - LIST_TTL_MS + 10_000, items: [] };
    return [];
  }
}

export async function readRecordingBytes(storedPath: string): Promise<Buffer> {
  const cfg = await getRecordingAccessConfig();
  const remote = resolveRemoteRecordingPath(cfg, storedPath);
  if (cfg.source === 'local') {
    const root = path.resolve(cfg.remote_root || '/recordings');
    const abs = path.resolve(remote);
    if (!abs.startsWith(root)) throw new Error('recording path outside root');
    return readFile(abs);
  }
  if (cfg.source === 'sftp') {
    if (!cfg.sftp_host || !cfg.sftp_user) throw new Error('sftp not configured');
    return sftpReadFile(cfg, remote);
  }
  throw new Error(`unsupported recording source: ${cfg.source}`);
}
