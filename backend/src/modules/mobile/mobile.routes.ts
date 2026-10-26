import { refreshManagedPushConfig } from '../../shared/services/push-account-config.js';
import { activeVdn } from '../access/access.scope.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { resolveCcsWorkNo } from '../../integrations/ccs/ccs-workno.js';
import { getVideoAgentConfig } from '../../shared/services/video-agent-config.js';
import { getSipCredentials } from '../../shared/services/sip-credentials.js';
import {
  listPushDevices,
  pushConfigured,
  registerPushDevice,
  unregisterPushDevice,
  type PushProvider,
} from '../../shared/services/push.js';
import { UnauthorizedError, ValidationError } from '../../shared/errors/index.js';

function currentWorkNo(req: FastifyRequest): string {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  return resolveCcsWorkNo({ ...user, uid: user.uid ?? null }, env.CCS_WORK_NO_FIELD);
}

/**
 * GET /api/agent/sip-credentials
 * 移动 App 启动或恢复前台时拉取一次，只在内存与系统 Keystore 持有，不落持久化配置。
 */
async function getAgentSipCredentials(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  const query = (req.query ?? {}) as { purpose?: 'voice' | 'video' | 'auto'; client?: 'web' | 'mobile' };
  // 凭据含密码，成功及拒绝响应都禁止缓存。
  reply.header('Cache-Control', 'no-store');
  const credentials = await getSipCredentials({
    userId: user.id,
    purpose: query.purpose,
    client: query.client,
    workNo: currentWorkNo(req),
    vdnId: activeVdn(env.OMNI_AGENT_VDN_ID),
  });
  return reply.send(credentials);
}

async function getAgentVideoConfig(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  reply.header('Cache-Control', 'no-store');
  return reply.send(await getVideoAgentConfig({
    userId: user.id, workNo: currentWorkNo(req), vdnId: activeVdn(0),
  }));
}

const PROVIDERS: PushProvider[] = ['fcm', 'apns', 'harmony', 'mipush', 'hms', 'oppo', 'vivo', 'honor'];

/** POST /api/agent/push-devices — App 拿到厂商 token 后注册，换绑到当前坐席。 */
async function postPushDevice(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  const body = (req.body ?? {}) as {
    provider?: string;
    token?: string;
    voip?: boolean;
    platform?: string;
    app_version?: string;
    bundle_id?: string;
  };
  const provider = PROVIDERS.find((p) => p === body.provider);
  const token = String(body.token ?? '').trim();
  if (!provider) throw new ValidationError(['provider 无效']);
  if (token.length < 16 || token.length > 4096 || /[\r\n]/.test(token)) throw new ValidationError(['token 无效']);

  const bundleId = String(body.bundle_id || 'com.smcloud.omniagent');
  if (!/^\w[\w.-]{1,254}$/.test(bundleId)) throw new ValidationError(['bundle_id 无效']);
  const { identifier } = await registerPushDevice({
    userId: user.id,
    provider,
    token,
    voip: body.voip === true,
    platform: body.platform,
    appVersion: body.app_version,
    bundleId,
  });
  return reply.send({ ok: true, identifier });
}

/** DELETE /api/agent/push-devices — 退出登录或关闭通知时注销，避免推给已换人的设备。 */
async function deletePushDevice(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  const token = String((req.body as { token?: string })?.token ?? '').trim();
  if (!token) throw new ValidationError(['token is required']);
  await unregisterPushDevice(user.id, token);
  return reply.send({ ok: true });
}

async function getPushDevices(req: FastifyRequest, reply: FastifyReply) {
  const user = req.currentUser;
  if (!user) throw new UnauthorizedError();
  await refreshManagedPushConfig();
  const devices = await listPushDevices(user.id);
  return reply.send({
    push_configured: pushConfigured(),
    devices: devices.map((d) => ({
      provider: d.provider,
      voip: d.voip,
      platform: d.platform,
      // 只回显尾段，避免日志与前端泄露完整 token
      token_tail: d.token.slice(-8),
    })),
  });
}

export async function mobileRoutes(fastify: FastifyInstance) {
  const auth = { preHandler: [fastify.authenticate] };

  fastify.get('/api/agent/video-config', auth, getAgentVideoConfig);
  fastify.get('/api/agent/sip-credentials', auth, getAgentSipCredentials);
  fastify.get('/api/agent/push-devices', auth, getPushDevices);
  fastify.post('/api/agent/push-devices', auth, postPushDevice);
  fastify.delete('/api/agent/push-devices', auth, deletePushDevice);
}
