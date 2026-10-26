import { prisma } from '../../plugins/db.js';

/**
 * 平台级短信服务商配置（由 ConfServer 运行时下发）。
 *
 * 与渠道级的 `channel_sms.provider_config` 的关系：
 * - 渠道级：单个短信通道的收发配置（号码、webhook 等），班长可维护；
 * - 平台级（本模块）：服务商接入参数（endpoint / 鉴权 / 签名 / 报备模板前缀），
 *   属于实例级敏感配置，走 ConfServer 下发，落 `platform_configs` 表。
 *
 * 出站优先级：渠道级 provider_config 里显式给了 url/endpoint 就用它，
 * 否则回退到这里的平台级配置 —— 这样「先填平台配置、再逐通道覆盖」都成立。
 *
 * provider 字段目前只是**标记**（如 'aliyun' / 'tencent' / 'yunpian'），
 * 通用 HTTP 转发不依赖它；将来接具体服务商时，按它分派到对应的签名实现即可。
 */

export interface SmsProviderConfig {
  /** 服务商标记：aliyun | tencent | yunpian | generic（留空视为 generic） */
  provider?: string;
  /** Write-only Aliyun credentials; registration settings are encrypted as a whole. */
  access_key_id?: string;
  access_key_secret?: string;
  /** 出站地址 */
  endpoint?: string;
  method?: string;
  /** 附加请求头，可放鉴权信息 */
  headers?: Record<string, string>;
  /**
   * 请求体模板。只支持字面量键值；发送时会自动补上
   * `to` / `content` / `from` / `template_id` 四个字段。
   */
  body?: Record<string, unknown>;
  /** 运营商报备的签名，如 [SeaMi] */
  sign_name?: string;
  /** 服务商侧默认模板 CODE（模板自身未指定 provider_template_id 时使用） */
  default_template_id?: string;
  /** 关闭后出站直接报错而不是静默失败 */
  enabled?: boolean;
  /** Explicit opt-in for mobile verification; only a reviewed verification template may be used. */
  login_enabled?: boolean;
  login_template_id?: string;
  login_phone_format?: 'e164' | 'national';
  /** Explicit opt-in and dedicated templates for Conf manager registration. */
  registration_enabled?: boolean;
  registration_template_id?: string;
  registration_notice_template_id?: string;
}

const CONFIG_KEY = 'sms_provider';

let runtimeValue: SmsProviderConfig | null = null;
let loaded = false;

function parse(raw: unknown): SmsProviderConfig | null {
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'object') return raw as SmsProviderConfig;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' ? (parsed as SmsProviderConfig) : null;
  } catch {
    return null;
  }
}

/** 同步读取：出站热路径调用它 */
export function getSmsProviderConfig(): SmsProviderConfig | null {
  return runtimeValue;
}

export function isSmsProviderLoaded(): boolean {
  return loaded;
}

/** 进程启动时调用一次：从 DB 恢复上次由 ConfServer 下发的配置 */
export async function loadSmsProviderFromDb(): Promise<SmsProviderConfig | null> {
  try {
    const row = await prisma.platform_configs.findUnique({ where: { key: CONFIG_KEY } });
    runtimeValue = parse(row?.value ?? null);
  } catch {
    runtimeValue = null;
  }
  loaded = true;
  return runtimeValue;
}

/** ConfServer 下发：落库 + 立即刷新内存缓存，无需重启容器 */
export async function setSmsProviderConfig(input: unknown): Promise<SmsProviderConfig> {
  const next = parse(input);
  if (!next) throw new Error('sms_provider 配置格式非法，应为 JSON 对象');
  const serialized = JSON.stringify(next);
  await prisma.platform_configs.upsert({
    where: { key: CONFIG_KEY },
    update: { value: serialized, category: 'channel' },
    create: {
      key: CONFIG_KEY,
      value: serialized,
      category: 'channel',
      description: '短信服务商接入配置（ConfServer 下发）：endpoint/鉴权/签名/默认报备模板',
    },
  });
  runtimeValue = next;
  return next;
}

/** 清空下发值，回退到渠道级配置 */
export async function clearSmsProviderConfig(): Promise<void> {
  await prisma.platform_configs.deleteMany({ where: { key: CONFIG_KEY } });
  runtimeValue = null;
}
