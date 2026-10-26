import type { FastifyInstance } from 'fastify';
import {
  getVdnWorkingHours,
  updateVdnWorkingHours,
} from './vdnworkinghours.controller.js';

/**
 * VDN 营业时间 API —— IVR 的 CheckWorkTime 节点读这张表。
 *
 * 路由不带 :vdn_id：VDN 取自登录用户的归属（access.vdnId），
 * 所有用户均不能通过 x-vdn-id 请求头覆盖登录归属。
 *
 * 与 inbox 级 working_hours 的区别见 controller 顶部注释。
 */
export async function vdnWorkingHoursRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/v1/vdn/working_hours', auth, getVdnWorkingHours);
  fastify.put('/api/v1/vdn/working_hours', auth, updateVdnWorkingHours);
}
