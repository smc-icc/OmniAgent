import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { ValidationError } from '../../shared/errors/index.js';
import { getAccess } from '../access/access.context.js';

/**
 * VDN 营业时间 API —— IVR 的 CheckWorkTime 节点读这张表决定走营业/非营业分支。
 *
 * 与 inbox 级 working_hours 的区别：
 *   working_hours         → omni 客服界面的在线/离线（per-inbox）
 *   conf_vdn_working_hours → IVR 呼入的营业时间分流（per-VDN，本模块）
 *
 * 路由不带 :vdn_id，VDN 一律取自登录用户的归属（access.vdnId）；
 * 所有用户均不能通过 x-vdn-id 请求头覆盖登录归属。
 *
 * 记录约定：
 *   day_of_week: 0=周日 1=周一 ... 6=周六
 *   closed_all_day=true  该天全天休息（open_* 忽略）
 *   open_all_day=true    该天 7x24 营业（open_* 忽略）
 *   例外情况按 open_hour:open_minutes ~ close_hour:close_minutes 判定（左闭右开）
 */

interface VdnWorkingHourInput {
  day_of_week: number;
  open_hour?: number;
  open_minutes?: number;
  close_hour?: number;
  close_minutes?: number;
  closed_all_day?: boolean;
  open_all_day?: boolean;
}

function formatRow(w: Record<string, unknown>) {
  return {
    id: w.id,
    vdn_id: w.vdn_id,
    day_of_week: w.day_of_week,
    closed_all_day: w.closed_all_day,
    open_all_day: w.open_all_day,
    open_hour: w.open_hour,
    open_minutes: w.open_minutes,
    close_hour: w.close_hour,
    close_minutes: w.close_minutes,
    updated_at: w.updated_at,
  };
}

/** 营业时间始终绑定登录用户所属 VDN，不接受客户端请求头覆盖。 */
async function resolveVdnId(request: FastifyRequest): Promise<number> {
  const access = await getAccess(request);
  const vdnId = Number(access.vdnId);
  if (!Number.isInteger(vdnId) || vdnId <= 0) {
    throw new ValidationError(['当前登录用户未绑定有效 VDN']);
  }
  return vdnId;
}

/** GET /api/v1/vdn/working_hours —— 返回 7 天完整配置（缺的补默认值） */
export async function getVdnWorkingHours(request: FastifyRequest, reply: FastifyReply) {
  const vdnId = await resolveVdnId(request);

  const rows = await prisma.conf_vdn_working_hours.findMany({
    where: { vdn_id: vdnId },
    orderBy: { day_of_week: 'asc' },
  });

  // 默认：工作日 09:00-18:00 营业，周末全天休息；已配置的用配置值
  const result: Record<number, Record<string, unknown>> = {};
  for (let d = 0; d < 7; d++) {
    const hit = rows.find((r) => r.day_of_week === d);
    result[d] = hit
      ? formatRow(hit as unknown as Record<string, unknown>)
      : {
          vdn_id: vdnId,
          day_of_week: d,
          closed_all_day: d === 0 || d === 6,
          open_all_day: false,
          open_hour: 9,
          open_minutes: 0,
          close_hour: 18,
          close_minutes: 0,
        };
  }

  return reply.status(200).send({ payload: { vdn_id: vdnId, working_hours: result } });
}

/** PUT /api/v1/vdn/working_hours —— 整体覆盖该 VDN 的 7 天配置 */
export async function updateVdnWorkingHours(request: FastifyRequest, reply: FastifyReply) {
  const vdnId = await resolveVdnId(request);
  const body = request.body as { working_hours?: VdnWorkingHourInput[] };

  if (!Array.isArray(body?.working_hours) || body.working_hours.length === 0) {
    throw new ValidationError(['working_hours array is required']);
  }

  const normalized: Array<{
    day_of_week: number;
    closed_all_day: boolean;
    open_all_day: boolean;
    open_hour: number;
    open_minutes: number;
    close_hour: number;
    close_minutes: number;
  }> = [];

  for (const wh of body.working_hours) {
    const day = Number(wh.day_of_week);
    if (!Number.isInteger(day) || day < 0 || day > 6) continue;

    const isClosed = wh.closed_all_day === true;
    const isOpenAll = wh.open_all_day === true;
    // 互斥：同时为真时以"休息"为准，避免歧义
    if (isClosed && isOpenAll) {
      normalized.push({
        day_of_week: day, closed_all_day: true, open_all_day: false,
        open_hour: 0, open_minutes: 0, close_hour: 0, close_minutes: 0,
      });
      continue;
    }

    const oh = Math.min(23, Math.max(0, Number(wh.open_hour ?? 9)));
    const om = Math.min(59, Math.max(0, Number(wh.open_minutes ?? 0)));
    const ch = Math.min(23, Math.max(0, Number(wh.close_hour ?? 18)));
    const cm = Math.min(59, Math.max(0, Number(wh.close_minutes ?? 0)));

    normalized.push({
      day_of_week: day,
      closed_all_day: isClosed,
      open_all_day: isOpenAll,
      // 全天营业归一化为 00:00-23:59，避免下游对 open_all_day 之外再做判断
      open_hour: isOpenAll ? 0 : (isClosed ? 0 : oh),
      open_minutes: isOpenAll ? 0 : (isClosed ? 0 : om),
      close_hour: isOpenAll ? 23 : (isClosed ? 0 : ch),
      close_minutes: isOpenAll ? 59 : (isClosed ? 0 : cm),
    });
  }

  if (normalized.length === 0) {
    throw new ValidationError(['working_hours 中没有任何合法的 day_of_week(0-6)']);
  }

  // 整体覆盖：先删后建，置于同一事务
  const saved = await prisma.$transaction(async (tx) => {
    await tx.conf_vdn_working_hours.deleteMany({ where: { vdn_id: vdnId } });
    const created = [];
    for (const row of normalized) {
      const rec = await tx.conf_vdn_working_hours.create({
        data: { vdn_id: vdnId, ...row },
      });
      created.push(formatRow(rec as unknown as Record<string, unknown>));
    }
    return created;
  });

  return reply.status(200).send({ payload: { vdn_id: vdnId, working_hours: saved } });
}
