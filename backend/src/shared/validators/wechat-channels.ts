import { z } from 'zod';
import { isKnownTrigger, ROUTE_APP_TYPES } from '../services/channel-route.js';

/**
 * 路由条目（三种渠道共用）。
 *
 * 抽成独立 schema 而不是只写在公众号里：路由本身与渠道无关，
 * 微信客服同样要能配自己的进线流程（on_inbound → itr/flow）。
 */
const routeEntrySchema = z.object({
  // 触发点必须命中白名单：写错一个字母就从"配了不生效"变成"同步时报错"。
  trigger: z
    .string()
    .min(1)
    .max(64)
    .refine(isKnownTrigger, {
      message: 'trigger 不是已知触发点（固定列表见 channel-route.ts 的 ROUTE_TRIGGERS，ACD 结果码用 on_acd_<码>）',
    }),
  priority: z.number().int().min(0).max(99).optional(),
  app_type: z.enum(ROUTE_APP_TYPES),
  flow_id: z.number().int().min(0).optional(),
  agent_id: z.number().int().min(0).optional(),
  robot_id: z.number().int().min(0).optional(),
  agent_group_id: z.number().int().optional(),
  skill_id: z.number().int().optional(),
  media_type: z.number().int().min(0).optional(),
  line_priority: z.number().int().min(0).optional(),
  timeout_seconds: z.number().int().min(0).max(86400).optional(),
  enabled: z.boolean().optional(),
});

const routesSchema = z.array(routeEntrySchema).optional();

export const createWechatMpSchema = z.object({
  name: z.string().min(1).max(100),
  app_id: z.string().min(1).max(64),
  app_secret: z.string().min(1).max(128),
  token: z.string().min(1).max(64),
  encoding_aes_key: z.string().max(64).optional(),
  account_type: z.enum(['service', 'subscribe', 'miniprogram']).default('service'),
  // 渠道能力：有没有「客服消息」权限。
  // 未认证订阅号（含个人号）填 false，改走被动回复 + 积压队列 + 精简菜单；
  // 认证通过后改回 true 即可切回主动推送，不用改代码、不用重新部署。
  supports_active_reply: z.boolean().optional(),
  passive_reply_enabled: z.boolean().optional(),
  route_ttl_seconds: z.number().int().min(30).max(86400).optional(),
  pending_reply_max: z.number().int().min(1).max(200).optional(),
  // 坐席回复超时（秒）。被动形态必须落在微信 5 秒窗口内；主动形态可以很长（默认 300）。
  // 0 = 不启用。这些字段此前不在 schema 里，导致 ConfServer 改了也同步不过来。
  reply_timeout_seconds: z.number().int().min(0).max(3600).optional(),
  reply_timeout_level2_seconds: z.number().int().min(0).max(86400).optional(),
  // 旧字段：一期已迁移到 channel_route 的 on_agent_no_reply，保留作为回退来源。
  reply_timeout_flow_id: z.number().int().min(0).optional(),
  pending_ttl_seconds: z.number().int().min(0).max(86400).optional(),
  // 会话闲置回收（秒）：客户最后发言后超过它无新消息，就回收会话（清归属与流程状态）。
  // 默认 300（5 分钟）；0 = 不回收。
  idle_recycle_seconds: z.number().int().min(0).max(86400).optional(),
  // 路由配置：由 ConfServer 的「路由」编辑器维护，同步进 channel_route 表。
  // 触发点见 docs/业务引擎设计.md（on_inbound / on_acd_<结果码> / on_agent_no_reply / ...）。
  routes: routesSchema,
  inbox_name: z.string().min(1).max(100).optional(),
});

export const updateWechatMpSchema = createWechatMpSchema.partial().omit({ app_id: true });

export const createWecomKfSchema = z.object({
  name: z.string().min(1).max(100),
  corp_id: z.string().min(1).max(64),
  secret: z.string().min(1).max(128),
  token: z.string().min(1).max(64),
  encoding_aes_key: z.string().max(64).optional(),
  open_kfid: z.string().max(64).optional(),
  // 微信客服可以配自己的路由：例如 on_inbound → itr/<流程>，
  // 让它用与公众号不同的欢迎语和菜单。
  routes: routesSchema,
  inbox_name: z.string().min(1).max(100).optional(),
});

export const updateWecomKfSchema = createWecomKfSchema.partial().omit({ corp_id: true });

export const createWecomContactSchema = z.object({
  name: z.string().min(1).max(100),
  corp_id: z.string().min(1).max(64),
  contact_secret: z.string().min(1).max(128),
  token: z.string().min(1).max(64),
  encoding_aes_key: z.string().max(64).optional(),
  agent_id: z.number().int().positive().optional(),
  routes: routesSchema,
  inbox_name: z.string().min(1).max(100).optional(),
});

export const updateWecomContactSchema = createWecomContactSchema.partial().omit({ corp_id: true });

export type CreateWechatMpInput = z.infer<typeof createWechatMpSchema>;
export type CreateWecomKfInput = z.infer<typeof createWecomKfSchema>;
export type CreateWecomContactInput = z.infer<typeof createWecomContactSchema>;
