/**
 * 全媒体运营配置（欢迎语 / 排队提示 / 接通语 / 敏感词 / 标签色 / FunASR）。
 * 存 platform_configs.omni_ops，Conf 同步；消息路径热读，短缓存。
 */
import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';

export type SensitiveMode = 'mask' | 'block';

export type OmniOpsLabel = { title: string; color: string };

export type OmniOps = {
  welcome_text: string;
  queue_tip: string;
  connect_tip: string;
  sensitive_words: string[];
  sensitive_mode: SensitiveMode;
  label_defaults: OmniOpsLabel[];
  asr_url: string;
  asr_timeout_ms: number;
};

export const DEFAULT_OMNI_OPS: OmniOps = {
  welcome_text: '您好，请问有什么可以帮您？',
  queue_tip: '正在为您转接人工客服，请稍候…',
  connect_tip: '{{agentName}}坐席为您服务',
  sensitive_words: [],
  sensitive_mode: 'mask',
  label_defaults: [
    { title: '重要', color: '#f56c6c' },
    { title: '跟进', color: '#e6a23c' },
    { title: '已解决', color: '#67c23a' },
  ],
  asr_url: '',
  asr_timeout_ms: 20_000,
};

const KEY = 'omni_ops';
const TTL_MS = 4000;

let cache: { at: number; value: OmniOps } | null = null;

export function invalidateOmniOpsCache(): void {
  cache = null;
}

function asStringArray(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v.map((x) => String(x || '').trim()).filter(Boolean);
}

function asLabels(v: unknown): OmniOpsLabel[] {
  if (!Array.isArray(v)) return DEFAULT_OMNI_OPS.label_defaults;
  const out: OmniOpsLabel[] = [];
  for (const row of v) {
    if (!row || typeof row !== 'object') continue;
    const title = String((row as OmniOpsLabel).title || '').trim();
    const color = String((row as OmniOpsLabel).color || '').trim() || '#1f93ff';
    if (title) out.push({ title, color });
  }
  return out.length ? out : DEFAULT_OMNI_OPS.label_defaults;
}

export function normalizeOmniOps(raw: unknown): OmniOps {
  const o = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const mode = o.sensitive_mode === 'block' ? 'block' : 'mask';
  const timeout = Number(o.asr_timeout_ms);
  return {
    welcome_text: String(o.welcome_text ?? DEFAULT_OMNI_OPS.welcome_text).trim() || DEFAULT_OMNI_OPS.welcome_text,
    queue_tip: String(o.queue_tip ?? DEFAULT_OMNI_OPS.queue_tip).trim() || DEFAULT_OMNI_OPS.queue_tip,
    connect_tip: String(o.connect_tip ?? DEFAULT_OMNI_OPS.connect_tip).trim() || DEFAULT_OMNI_OPS.connect_tip,
    sensitive_words: asStringArray(o.sensitive_words),
    sensitive_mode: mode,
    label_defaults: asLabels(o.label_defaults),
    asr_url: String(o.asr_url ?? '').trim(),
    asr_timeout_ms: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_OMNI_OPS.asr_timeout_ms,
  };
}

export async function loadOmniOps(): Promise<OmniOps> {
  const now = Date.now();
  if (cache && now - cache.at < TTL_MS) return cache.value;
  try {
    const row = await prisma.platform_configs.findFirst({ where: { key: KEY } });
    const parsed = row?.value ? JSON.parse(row.value) : {};
    const value = normalizeOmniOps(parsed);
    cache = { at: now, value };
    return value;
  } catch {
    cache = { at: now, value: { ...DEFAULT_OMNI_OPS } };
    return cache.value;
  }
}

export async function saveOmniOps(input: unknown): Promise<OmniOps> {
  const value = normalizeOmniOps(input);
  await prisma.platform_configs.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(value), category: 'params', description: '全媒体运营配置', updated_at: new Date() },
    create: {
      key: KEY,
      value: JSON.stringify(value),
      category: 'params',
      description: '全媒体运营配置',
    },
  });
  cache = { at: Date.now(), value };
  await syncDefaultLabels(value.label_defaults).catch(() => {});
  return value;
}

async function syncDefaultLabels(labels: OmniOpsLabel[]): Promise<void> {
  for (const item of labels) {
    const title = item.title.toLowerCase();
    const existing = await prisma.labels.findFirst({ where: { account_id: 1, title } });
    if (existing) {
      if (existing.color !== item.color) {
        await prisma.labels.update({ where: { id: existing.id }, data: { color: item.color } });
      }
    } else {
      await prisma.labels.create({
        data: {
          account_id: 1,
          title,
          description: '',
          color: item.color,
          show_on_sidebar: true,
        },
      });
    }
  }
}

export type SensitiveResult = {
  text: string;
  hit: boolean;
  blocked: boolean;
  words: string[];
};

export function applySensitiveFilter(text: string, ops: OmniOps): SensitiveResult {
  const src = String(text || '');
  const words = ops.sensitive_words.filter(Boolean);
  if (!src || !words.length) return { text: src, hit: false, blocked: false, words: [] };
  const hits: string[] = [];
  let next = src;
  for (const w of words) {
    if (!w) continue;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    if (re.test(src)) hits.push(w);
    next = next.replace(re, '*'.repeat(Math.min(w.length, 8) || 1));
  }
  if (!hits.length) return { text: src, hit: false, blocked: false, words: [] };
  if (ops.sensitive_mode === 'block') {
    return { text: '[消息包含敏感词，已拦截]', hit: true, blocked: true, words: hits };
  }
  return { text: next, hit: true, blocked: false, words: hits };
}

export async function filterMessageContent(text: string): Promise<SensitiveResult> {
  const ops = await loadOmniOps();
  return applySensitiveFilter(text, ops);
}

export async function getQueueTip(fallback?: string): Promise<string> {
  const ops = await loadOmniOps();
  return String(fallback || '').trim() || ops.queue_tip;
}

export async function getConnectTip(fallback?: string): Promise<string> {
  const ops = await loadOmniOps();
  return String(fallback || '').trim() || ops.connect_tip;
}

export async function getWelcomeText(): Promise<string> {
  const ops = await loadOmniOps();
  return ops.welcome_text;
}

/** 其它 ASR 的 HTTP 覆盖：Conf 优先，否则 FUNASR_ASR_URL。空则走 TARS ASRServer */
export async function resolveAsrUrl(): Promise<string> {
  const ops = await loadOmniOps();
  return ops.asr_url || (env.FUNASR_ASR_URL || '').trim();
}

export async function resolveAsrTimeoutMs(): Promise<number> {
  const ops = await loadOmniOps();
  return ops.asr_timeout_ms || env.FUNASR_ASR_TIMEOUT_MS || 20_000;
}
