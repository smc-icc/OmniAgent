import { prisma } from '../../plugins/db.js';
import { env } from '../../config/env.js';

/**
 * 对外公网根地址（所有渠道 webhook 的公共基址）。
 *
 * 存 `platform_configs` 表，key 为 `public_base_url`，属**实例级**配置：
 * 一个 Omni 进程只有一个对外入口，webhook 路径 `/webhooks/<渠道>/<id>` 不含 VDN 段，
 * 因此不按 VDN 区分。若将来出现"一个实例服务多个对外域名"，再把 key 扩展为
 * `public_base_url:<vdn>` 即可，本模块的读写接口保持不变。
 *
 * 读取顺序：ConfServer 运行时下发（DB）→ 启动时的环境变量 PUBLIC_BASE_URL。
 */
const CONFIG_KEY = 'public_base_url';

let runtimeValue: string | null = null;
let loaded = false;

function normalize(url: string): string {
  return (url ?? '').trim().replace(/\/+$/, '');
}

/** 同步读取：webhook URL 生成等热路径调用它，因此必须保持同步 */
export function getPublicBaseUrl(): string {
  return normalize(runtimeValue ?? env.PUBLIC_BASE_URL);
}

/** 当前值来自运行时下发（而非环境变量兜底） */
export function isPublicBaseUrlFromRuntime(): boolean {
  return runtimeValue !== null;
}

export function isPublicBaseUrlLoaded(): boolean {
  return loaded;
}

/** 进程启动时调用一次：从 DB 恢复上次由 ConfServer 下发的值 */
export async function loadPublicBaseUrlFromDb(): Promise<string> {
  try {
    const row = await prisma.platform_configs.findUnique({ where: { key: CONFIG_KEY } });
    runtimeValue = row?.value ? normalize(row.value) : null;
  } catch {
    runtimeValue = null;
  }
  loaded = true;
  return getPublicBaseUrl();
}

/** ConfServer 下发：落库 + 立即刷新内存缓存，无需重启容器 */
export async function setPublicBaseUrl(url: string): Promise<string> {
  const next = normalize(url);
  if (!next) throw new Error('public_base_url 不能为空');
  await prisma.platform_configs.upsert({
    where: { key: CONFIG_KEY },
    update: { value: next, category: 'general' },
    create: {
      key: CONFIG_KEY,
      value: next,
      category: 'general',
      description: '对外公网根地址：所有渠道 webhook 的公共基址（ConfServer 下发）',
    },
  });
  runtimeValue = next;
  return next;
}
