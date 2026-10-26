import { productModuleRoutes } from './modules/product-modules/routes.js';
import { extensionBindingRoutes } from './modules/extension-binding/routes.js';
import Fastify from 'fastify';
import { accessRoutes } from './modules/access/access.routes.js';
import { announcementRoutes } from './modules/announcements/announcements.routes.js';
import { installAccessGuard } from './modules/access/access.guard.js';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import jwt from '@fastify/jwt';
import sensible from '@fastify/sensible';
import fastifyStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from './config/env.js';
import { registerErrorHandler } from './shared/errors/index.js';
import dbPlugin from './plugins/db.js';
import redisPlugin from './plugins/redis.js';
import authPlugin from './plugins/auth.js';
import socketioPlugin from './plugins/socketio.js';
import ccsPlugin from './plugins/ccs.js';
import bullmqPlugin from './plugins/bullmq.js';
import s3Plugin, { directUploadRoute } from './plugins/s3.js';
import llmPlugin from './plugins/llm.js';
import hubPlugin from './plugins/hub.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { loginCodeRoutes } from './modules/auth/login-code.routes.js';
import { phoneAuthRoutes } from './modules/auth/phone-auth.routes.js';
import { socialAuthRoutes } from './modules/social-auth/social.routes.js';
import { accountsRoutes } from './modules/accounts/accounts.routes.js';
import { inboxesRoutes } from './modules/inboxes/inboxes.routes.js';
import { conversationsRoutes } from './modules/conversations/conversations.routes.js';
import { contactsRoutes } from './modules/contacts/contacts.routes.js';
import { efficiencyRoutes } from './modules/efficiency/efficiency.routes.js';
import { captainRoutes } from './modules/captain/captain.routes.js';
import { notificationsRoutes } from './modules/notifications/notifications.routes.js';
import { integrationsRoutes } from './modules/integrations/integrations.routes.js';
import { omnichannelRoutes } from './modules/omnichannel/omnichannel.routes.js';
import { mobileRoutes } from './modules/mobile/mobile.routes.js';
import { videoCustomerRoutes } from './modules/video/video-customer.routes.js';
import { agentToolsRoutes } from './modules/agent_tools/agent_tools.routes.js';
import { platformConfigRoutes } from './modules/platform_config/platform_config.routes.js';
import widgetRoutes from './modules/widget/widget.routes.js';
import helpCenterRoutes from './modules/helpcenter/helpcenter.routes.js';
import { labelsRoutes } from './modules/labels/labels.routes.js';
import { campaignsRoutes } from './modules/campaigns/campaigns.routes.js';
import { workingHoursRoutes } from './modules/workinghours/workinghours.routes.js';
import { vdnWorkingHoursRoutes } from './modules/vdnworkinghours/vdnworkinghours.routes.js';
import { dashboardAppsRoutes } from './modules/dashboardapps/dashboardapps.routes.js';
import { wechatRoutes } from './modules/wechat/wechat.routes.js';
import { itrRoutes } from './modules/itr/itr.routes.js';
import { aiqcRoutes } from './modules/aiqc/aiqc.routes.js';
import { biRoutes } from './modules/reports/bi.routes.js';
import { performanceRoutes } from './modules/reports/performance.routes.js';
import { smsTemplateRoutes } from './modules/channels/sms/templates.routes.js';
import { emailSendRoutes } from './modules/channels/email/send.routes.js';
import { globalSearchRoutes } from './modules/search/global-search.routes.js';
import { knowledgeRoutes } from './modules/knowledge/knowledge.routes.js';

/**
 * Build and configure the Fastify application instance.
 * Plugins are registered in dependency order.
 */
export async function buildApp() {
  const fastify = Fastify({
    pluginTimeout: 60_000,
    logger: {
      level: env.NODE_ENV === 'development' ? 'info' : 'warn',
      transport: env.NODE_ENV === 'development'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
    ajv: {
      customOptions: { coerceTypes: 'array' },
    },
  });

  // ── Global error handler ──
  registerErrorHandler(fastify);

  // ── BigInt serialization support ──
  fastify.setReplySerializer((payload) => {
    return JSON.stringify(payload, (_key, value) =>
      typeof value === 'bigint' ? Number(value) : value
    );
  });

  // ── Health：尽早注册，避免 CCS 等重插件拖住探针 ──
  fastify.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    timestamp: new Date().toISOString(),
  }));

  // ── Sensible (httpErrors, asserts) ──
  await fastify.register(sensible);

  fastify.addContentTypeParser(
    ['text/xml', 'application/xml', 'text/plain'],
    { parseAs: 'string' },
    (_req, body, done) => {
      done(null, body);
    },
  );

  // ── CORS ──
  await fastify.register(cors, {
    origin: true,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Account-Id', 'X-Auth-Token', 'X-Website-Token', 'api_access_token', 'X-Omni-Signature', 'X-Chatwoot-Signature', 'X-Platform-Sync-Token'],
  });

  // ── JWT ──
  await fastify.register(jwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: '30d' },
  });

  // ── Database (Prisma) ──
  await fastify.register(dbPlugin);

  // ── Redis ──
  await fastify.register(redisPlugin);

  // ── Auth (load current user/account) ──
  await fastify.register(authPlugin);
  installAccessGuard(fastify);
  await fastify.register(accessRoutes);
  await fastify.register(extensionBindingRoutes);
  await fastify.register(announcementRoutes);
  await fastify.register(globalSearchRoutes);

  // ── Socket.io (real-time) ──
  await fastify.register(socketioPlugin);

  // ── CCS telephony bridge (TARS + Socket.io) ──
  await fastify.register(productModuleRoutes);
  await fastify.register(ccsPlugin);

  // ── BullMQ (background jobs) ──
  await fastify.register(bullmqPlugin);

  await fastify.register(multipart, {
    limits: { fileSize: 20 * 1024 * 1024 },
  });

  // ── S3 (file uploads) ──
  await fastify.register(s3Plugin);
  await fastify.register(knowledgeRoutes);

  // ── ICC Integration Hub (HUB_ENABLED=0 时零副作用) ──
  await fastify.register(hubPlugin);

  // ── LLM (AI / OpenAI) ──
  await fastify.register(llmPlugin);

  // ── Serve demo static files ──
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  // demo 是随构建产物一起部署的静态资源：生产环境为 dist/demo（镜像内即 /app/dist/demo），
  // 开发态回退到仓库布局 OmniAgent/demo。
  const demoCandidates = [
    path.join(__dirname, 'demo'),
    path.join(__dirname, '../../demo'),
  ];
  const demoPath = demoCandidates.find((p) => existsSync(p)) ?? demoCandidates[0];
  await fastify.register(fastifyStatic, {
    root: demoPath,
    prefix: '/demo/',
  });
  // Root redirect to demo
  fastify.get('/', async (_req, reply) => reply.redirect('/demo/index.html'));

  // ── API index ──
  fastify.get('/api', async () => ({
    version: '0.1.0',
    name: 'OmniAgent API',
    description: 'Chatwoot-compatible backend — Node.js (Fastify + TypeScript)',
  }));

  // ── Direct file upload ──
  fastify.post('/api/v1/upload', { preHandler: [fastify.authenticate] }, directUploadRoute);
  fastify.post('/api/v1/accounts/:account_id/upload', { preHandler: [fastify.authenticate] }, directUploadRoute);

  // ── Auth routes ──
  await fastify.register(authRoutes);
  await fastify.register(loginCodeRoutes);
  await fastify.register(phoneAuthRoutes);
  await fastify.register(socialAuthRoutes);

  // ── Account scoped routes ──
  await fastify.register(accountsRoutes);

  // ── Inboxes & Channels ──
  await fastify.register(inboxesRoutes);

  // ── Conversations & Messages ──
  await fastify.register(conversationsRoutes);

  // ── Contacts ──
  await fastify.register(contactsRoutes);

  // ── Efficiency Tools ──
  await fastify.register(efficiencyRoutes);

  // ── AI Captain ──
  await fastify.register(captainRoutes);

  // ── Notifications, Search, Reports ──
  await fastify.register(notificationsRoutes);

  // ── Portals, Integrations, Webhooks, Enterprise, Platform, Widget ──
  await fastify.register(integrationsRoutes);

  // ── WeChat MP / WeCom KF / WeCom Contact ──
  await fastify.register(wechatRoutes);

  // ── OmniAgent Dashboard (agent status, dashboard, navigation) ──
  await fastify.register(omnichannelRoutes);

  // ── 移动坐席（SIP 凭据下发 + 推送设备注册）──
  await fastify.register(mobileRoutes);
  await fastify.register(videoCustomerRoutes);

  // ── ITR (online pre-queue) + ACD ring path A ──
  await fastify.register(itrRoutes);

  // ── AIQC (Python TARS quality-inspection service BFF) ──
  await fastify.register(aiqcRoutes);

  await fastify.register(biRoutes);
  await fastify.register(performanceRoutes);

  // ── 短信模板（班长维护）+ 定向发送 ──
  await fastify.register(smsTemplateRoutes);

  // ── 跨渠道发邮件 ──
  await fastify.register(emailSendRoutes);

  fastify.addHook('onReady', async () => {
    try {
      const { refreshManagedPushConfig } = await import('./shared/services/push-account-config.js');
      await refreshManagedPushConfig();
    } catch { fastify.log.warn('Managed push configuration could not be loaded'); }
    try {
      const { loadPublicBaseUrlFromDb } = await import('./shared/services/public-base-url.js');
      const publicBaseUrl = await loadPublicBaseUrlFromDb();
      fastify.log.info({ publicBaseUrl }, 'public base url loaded');
    } catch (err) {
      fastify.log.warn({ err }, 'public base url load failed');
    }
    try {
      const { loadSmsProviderFromDb } = await import('./shared/services/sms-provider.js');
      const smsProvider = await loadSmsProviderFromDb();
      fastify.log.info({ provider: smsProvider?.provider ?? null }, 'sms provider config loaded');
    } catch (err) {
      fastify.log.warn({ err }, 'sms provider config load failed');
    }
    try {
      const { ensureVoiceInbox } = await import('./shared/services/voice-inbox.js');
      await ensureVoiceInbox(1);
      fastify.log.info('Voice inbox ready');
    } catch (err) {
      fastify.log.warn({ err }, 'ensureVoiceInbox failed');
    }
    try {
      const { restoreItrRuntime } = await import('./modules/itr/itr-queue.js');
      const restored = await restoreItrRuntime();
      fastify.log.info(restored, 'ITR runtime restored');
    } catch (err) {
      fastify.log.warn({ err }, 'ITR runtime restore failed');
    }
    try {
      const { startItrObserveClient } = await import('./integrations/itr/itr-observe-client.js');
      startItrObserveClient(fastify);
    } catch (err) {
      fastify.log.warn({ err }, 'ITR observe WS client failed to start');
    }
  });

  // ── Phase 9: Voicemail, Outbound, Monitor, Inspection, Contacts ──
  await fastify.register(agentToolsRoutes);

  // ── Platform Configuration (API keys, integrations, system params) ──
  await fastify.register(platformConfigRoutes);

  // ── Public Widget API (customer-facing chat widget) ──
  await fastify.register(widgetRoutes);

  // ── Public Help Center (customer-facing knowledge base) ──
  await fastify.register(helpCenterRoutes);

  // ── Labels (standalone management) ──
  await fastify.register(labelsRoutes);

  // ── Campaigns (marketing campaigns) ──
  await fastify.register(campaignsRoutes);

  // ── Working Hours (per-inbox operating hours) ──
  await fastify.register(workingHoursRoutes);

  // ── VDN Working Hours (IVR CheckWorkTime 节点读它决定营业/非营业分支) ──
  await fastify.register(vdnWorkingHoursRoutes);

  // ── Dashboard Apps (iframe apps in agent dashboard) ──
  await fastify.register(dashboardAppsRoutes);

  // ── Email IMAP polling (inbound) ──
  const { pollEmailInboxes } = await import('./modules/channels/email/fetch-job.js');
  const emailPollMs = env.EMAIL_INBOX_POLL_INTERVAL_MS;
  if (emailPollMs > 0) {
    const emailHooks = {
      emitToAccount: (accountId: number, event: string, data: unknown) => {
        fastify.io?.to(`account:${accountId}`).emit(event, data);
      },
      enqueue: (queue: string, job: string, data: unknown) => fastify.enqueue(queue, job, data),
    };
    fastify.addHook('onReady', () => {
      const run = () => {
        pollEmailInboxes(emailHooks).catch((err) => fastify.log.error({ err }, 'email IMAP poll failed'));
      };
      run();
      setInterval(run, emailPollMs);
      fastify.log.info({ intervalMs: emailPollMs }, 'email IMAP polling enabled');
    });
  }

  return fastify;
}
