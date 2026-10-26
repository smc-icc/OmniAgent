/**
 * 微信公众号「被动回复」模式支撑。
 *
 * 背景：未认证公众号（含个人订阅号）没有「客服消息」权限，主动推送必然失败。
 * 微信只留了一条路——**收到用户消息后 5 秒内，用 webhook 的 XML 应答回一条内容**。
 * 于是坐席/ITR 的主动下发在这里被改写成两条路径：
 *
 *   1) 正好有 webhook 在等（等待槽 open）→ 直接投递给它，作为这次请求的被动回复；
 *   2) 没有等待者                        → 压入 Redis 积压队列，
 *                                          等访客下次发言时随那次的被动回复一并带回。
 *
 * 两条路径都以「回合制」为前提：访客不说话，回复就送不出去。这是被动回复的天花板，
 * 不是实现缺陷。坐席侧通过 pending_passive 标记能看出「这条还没送到客户」。
 *
 * 与其他渠道无关：只有公众号出站走微信客服消息 API，其余渠道（Widget/API/小程序/
 * 微博/邮件/短信/企微客服）出站是我们自己的通道，不受这里任何逻辑影响。
 */
import { redis } from '../../plugins/redis.js';

/** 只取被动回复所需的渠道字段，避免与 Prisma 类型耦合 */
export interface PassiveReplyChannel {
  supports_active_reply?: boolean | null;
  passive_reply_enabled?: boolean | null;
}

const DEFAULT_PENDING_MAX = 20;
const DEFAULT_ROUTE_TTL_SEC = 300;
/** 留一点余量：微信硬限制 5 秒，超时后必须回 'success' */
const DEFAULT_SLOT_TIMEOUT_MS = 4500;
const PENDING_TTL_SEC = 86400 * 3;
const DRAIN_BATCH_MAX = 50;
/** 微信被动回复正文上限（字节，UTF-8） */
export const PASSIVE_REPLY_MAX_BYTES = 2048;

/** 该渠道是否不具备客服消息权限（需要走被动回复） */
export function isActiveReplyDisabled(channel: PassiveReplyChannel | null | undefined): boolean {
  return channel?.supports_active_reply === false;
}

/** 被动回复模式是否真正启用（缺了 passive_reply_enabled 就宁可报错，也不静默丢消息） */
export function isPassiveReplyEnabled(channel: PassiveReplyChannel | null | undefined): boolean {
  return isActiveReplyDisabled(channel) && channel?.passive_reply_enabled === true;
}

function resolvePendingMax(max?: number | null): number {
  return typeof max === 'number' && Number.isFinite(max) && max > 0
    ? Math.floor(max)
    : DEFAULT_PENDING_MAX;
}

function resolveRouteTtl(ttlSec?: number | null): number {
  return typeof ttlSec === 'number' && Number.isFinite(ttlSec) && ttlSec > 0
    ? Math.floor(ttlSec)
    : DEFAULT_ROUTE_TTL_SEC;
}

const pendingKey = (appId: string, openid: string) => `omni:wechat_mp:pending:${appId}:${openid}`;
const routeKey = (appId: string, openid: string) => `omni:wechat_mp:route:${appId}:${openid}`;
const slotKey = (appId: string, openid: string) => `${appId}:${openid}`;

// ── 被动回复等待槽（进程内） ──
//
// 之所以用进程内 Map 而不是 Redis：等待方和 ITR 回调在同一个 Omni 进程里就够用，
// 引入 Redis pub/sub 会让链路更难排查。多实例部署时，回调若落到别的实例，
// 槽自然超时，内容改走积压队列 —— 退化行为是正确的，不丢消息。

interface SlotEntry {
  resolve: (text: string) => void;
  /** 同一个等待窗口内收到的多条 reply，最后合并成一条被动回复 */
  parts: string[];
  /** 总超时（微信硬限制 5 秒） */
  timer: ReturnType<typeof setTimeout>;
  /** 合并窗口定时器：一轮流程说完了就送出 */
  quietTimer: ReturnType<typeof setTimeout> | null;
}

const slots = new Map<string, SlotEntry>();

/** 同一轮 reply 之间的静默间隔，超过它认为这一轮说完了 */
const REPLY_QUIET_MS = 220;

export interface PassiveSlot {
  /** ITR / 坐席在超时前投递的文本（多条自动合并）；无人投递或超时则为空串 */
  wait: Promise<string>;
  close: () => void;
}

/** 把槽里已收集的内容合并送出并清槽 */
function flushSlot(key: string): void {
  const entry = slots.get(key);
  if (!entry) return;
  slots.delete(key);
  clearTimeout(entry.timer);
  if (entry.quietTimer) clearTimeout(entry.quietTimer);
  entry.resolve(joinPassiveReplies(entry.parts));
}

/** webhook 进入时开槽。同一访客并发两条时，后一条顶掉前一条（前一条回 success）。 */
export function openPassiveSlot(
  appId: string,
  openid: string,
  timeoutMs: number = DEFAULT_SLOT_TIMEOUT_MS,
): PassiveSlot {
  closePassiveSlot(appId, openid);
  const key = slotKey(appId, openid);
  let settle: (text: string) => void = () => {};
  const wait = new Promise<string>((resolve) => {
    settle = resolve;
  });
  const timer = setTimeout(() => {
    flushSlot(key);
  }, timeoutMs);
  // 等待微信回复不该拖住进程退出
  timer.unref?.();
  slots.set(key, { resolve: settle, parts: [], timer, quietTimer: null });
  return {
    wait,
    close: () => closePassiveSlot(appId, openid),
  };
}

export function closePassiveSlot(appId: string, openid: string): void {
  flushSlot(slotKey(appId, openid));
}

/**
 * 把一条出站内容投递给正在等待的 webhook。
 *
 * 一轮流程（欢迎语 / 图文 / 菜单）会连着回调多条 reply，而微信对一条用户消息
 * 只接受一条被动回复，所以这里不立刻返回：先收进 parts，等静默 REPLY_QUIET_MS
 * 再合并送出。否则客户只看得到第一条，得再发一条消息才看得到菜单。
 *
 * @returns true 表示已收下（调用方不应再入队）
 */
export function deliverToPassiveSlot(appId: string, openid: string, content: string): boolean {
  const key = slotKey(appId, openid);
  const entry = slots.get(key);
  if (!entry) return false;
  const text = String(content ?? '').trim();
  if (text) entry.parts.push(text);
  if (entry.quietTimer) clearTimeout(entry.quietTimer);
  entry.quietTimer = setTimeout(() => flushSlot(key), REPLY_QUIET_MS);
  entry.quietTimer.unref?.();
  return true;
}

/** 是否有 webhook 正等着这个访客的被动回复 */
export function hasPassiveSlot(appId: string, openid: string): boolean {
  return slots.has(slotKey(appId, openid));
}

// ── 积压队列（Redis List） ──

/**
 * 出站内容先行压入积压队列，等访客下次发言时带回。
 * 超过上限时丢弃**最旧**的（新的对话上下文比陈旧的更值得保留）。
 * @returns 入队后的队列长度，失败返回 0
 */
export async function enqueuePendingReply(
  appId: string,
  openid: string,
  content: string,
  max?: number | null,
): Promise<number> {
  const text = String(content ?? '').trim();
  if (!text || !openid || !appId) return 0;
  const key = pendingKey(appId, openid);
  const limit = resolvePendingMax(max);
  try {
    // 带上入队时间：取回时要按渠道配置的存活时长判断是否已经陈旧。
    await redis.rpush(key, JSON.stringify({ text, at: Date.now() }));
    await redis.ltrim(key, -limit, -1);
    await redis.expire(key, PENDING_TTL_SEC);
    return await redis.llen(key);
  } catch {
    return 0;
  }
}

/**
 * 取走该访客的全部积压内容（按入队顺序）。
 * 用逐条 LPOP 而不是 LRANGE+DEL：取出即删除，避免与并发入队竞态。
 *
 * @param ttlSec 存活时长（秒）：超过它的积压视为陈旧、直接丢弃；0 或未传 = 不过期。
 *   没有这一步，客户下次发言会莫名其妙收到几小时前的内容
 *   （实测遇到过：客户发「测试」，收到的却是两小时前的「？」）。
 */
export async function drainPendingReplies(
  appId: string,
  openid: string,
  ttlSec?: number | null,
): Promise<string[]> {
  if (!appId || !openid) return [];
  const key = pendingKey(appId, openid);
  const ttl =
    typeof ttlSec === 'number' && Number.isFinite(ttlSec) && ttlSec > 0 ? ttlSec : 0;
  const now = Date.now();
  const out: string[] = [];
  try {
    for (let i = 0; i < DRAIN_BATCH_MAX; i += 1) {
      const item = await redis.lpop(key);
      if (item === null || item === undefined) break;
      const raw = String(item).trim();
      if (!raw) continue;
      // 兼容旧格式（纯文本）：解析不出时间戳就当作「不过期」处理
      let text = raw;
      let at = 0;
      if (raw.startsWith('{')) {
        try {
          const parsed = JSON.parse(raw) as { text?: unknown; at?: unknown };
          text = String(parsed.text ?? '').trim();
          at = Number(parsed.at) || 0;
        } catch {
          text = raw;
          at = 0;
        }
      }
      if (!text) continue;
      if (ttl > 0 && at > 0 && now - at > ttl * 1000) continue; // 陈旧，丢弃
      out.push(text);
    }
  } catch {
    return out;
  }
  return out;
}

export async function pendingReplyCount(appId: string, openid: string): Promise<number> {
  try {
    return await redis.llen(pendingKey(appId, openid));
  } catch {
    return 0;
  }
}

// ── 菜单路由记录 ──
//
// 被动模式下 ITR 会话在流程结束时就 sessions.pop() 了，撑不过 5 分钟的等待窗口，
// 所以「访客刚才选了哪个分支」必须存在 Omni 这边。

export interface MenuRoute {
  /** 分支落点节点 id */
  node: string;
  /** 分支标识（如 '4' 留言） */
  branch: string;
  /** 记录时间（epoch ms） */
  at: number;
}

export async function setMenuRoute(
  appId: string,
  openid: string,
  route: { node?: string; branch?: string },
  ttlSec?: number | null,
): Promise<void> {
  if (!appId || !openid) return;
  const payload: MenuRoute = {
    node: String(route?.node ?? ''),
    branch: String(route?.branch ?? ''),
    at: Date.now(),
  };
  try {
    await redis.set(routeKey(appId, openid), JSON.stringify(payload), 'EX', resolveRouteTtl(ttlSec));
  } catch {
    /* 路由记录是体验优化，写失败就当作未命中 */
  }
}

export async function getMenuRoute(appId: string, openid: string): Promise<MenuRoute | null> {
  if (!appId || !openid) return null;
  try {
    const raw = await redis.get(routeKey(appId, openid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as MenuRoute;
    if (!parsed || typeof parsed !== 'object') return null;
    return { node: String(parsed.node ?? ''), branch: String(parsed.branch ?? ''), at: Number(parsed.at) || 0 };
  } catch {
    return null;
  }
}

export async function clearMenuRoute(appId: string, openid: string): Promise<void> {
  try {
    await redis.del(routeKey(appId, openid));
  } catch {
    /* ignore */
  }
}

// ── 被动回复正文组装 ──

/** 按字节截断，且不切断多字节字符 */
function truncateUtf8(text: string, maxBytes: number): string {
  let bytes = 0;
  let cut = 0;
  for (const ch of text) {
    const n = Buffer.byteLength(ch, 'utf8');
    if (bytes + n > maxBytes) break;
    bytes += n;
    cut += ch.length;
  }
  if (cut >= text.length) return text;
  return `${text.slice(0, cut)}…`;
}

/**
 * 多条积压拼接为一条：微信对「一条用户消息」只接受一条被动回复，
 * 所以积压内容只能合并，并按 2048 字节截断。
 */
export function joinPassiveReplies(
  parts: Array<string | null | undefined>,
  maxBytes: number = PASSIVE_REPLY_MAX_BYTES,
): string {
  const kept: string[] = [];
  let used = 0;
  for (const raw of parts) {
    const text = String(raw ?? '').trim();
    if (!text) continue;
    const sepBytes = kept.length ? 1 : 0; // '\n'
    if (used + sepBytes + Buffer.byteLength(text, 'utf8') <= maxBytes) {
      kept.push(text);
      used += sepBytes + Buffer.byteLength(text, 'utf8');
      continue;
    }
    const room = maxBytes - used - sepBytes;
    if (room > 8) kept.push(truncateUtf8(text, room));
    break;
  }
  return kept.join('\n');
}
