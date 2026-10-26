import { createHmac } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { AppError } from '../../shared/errors/index.js';
import { browserSipSettings, checkVideoOrigin, parseVideoEntries } from './video-customer.policy.js';
import { createVideoLease, revokeVideoLease } from './video-customer.repository.js';

export async function videoCustomerRoutes(app: FastifyInstance) {
  const enabled = () => {
    if (!env.VIDEO_CUSTOMER_ENABLED) throw new AppError(503, 'Video customer service is not active');
    if (!/^[a-zA-Z0-9_.-]+$/.test(env.SIP_REALM)) throw new AppError(503, 'Video SIP realm is not configured');
    return browserSipSettings(env.SIP_WSS_URL, env.SIP_ICE_SERVERS_JSON);
  };
  const entry = (id: string) => {
    const result = parseVideoEntries(env.VIDEO_ENTRIES_JSON).find(e => e.id === id);
    if (!result) throw new AppError(404, 'Video entry not found');
    return result;
  };
  app.addHook('onSend', async (_req, reply) => { reply.header('Cache-Control', 'no-store'); reply.header('Referrer-Policy', 'no-referrer'); });
  app.get<{ Params: { entryId: string } }>('/public/api/video/entries/:entryId', async req => {
    enabled(); const value = entry(req.params.entryId);
    return { id: value.id, label: value.label };
  });
  app.post<{ Params: { entryId: string }; Body: { called: string; media_type?: 0 | 1 } }>('/public/api/video/entries/:entryId/sessions', {
    preValidation: async req => {
      const body = req.body;
      if (body && typeof body === 'object' && !Array.isArray(body) && (Object.keys(body).some(key => key !== 'called' && key !== 'media_type')
          || ('media_type' in body && body.media_type !== 0 && body.media_type !== 1))) {
        throw new AppError(400, 'Invalid visitor media type or session parameters');
      }
    },
    schema: { body: { type: 'object', additionalProperties: false, maxProperties: 2, required: ['called'], properties: { media_type: { type: 'integer', enum: [0, 1], nullable: false }, called: { type: 'string', pattern: '^[1-9][0-9]{2,19}$' } } } },
  }, async req => {
    const web = enabled();
    checkVideoOrigin(req.headers.origin, env.PUBLIC_BASE_URL);
    const value = entry(req.params.entryId);
    const called = req.body.called;
    // Do not trust client-provided X-Forwarded-For without an explicit trusted proxy.
    const ipKey = createHmac('sha256', env.JWT_SECRET).update(req.ip).digest('hex');
    const lease = await createVideoLease(value, env.SIP_REALM, ipKey, called, req.body.media_type ?? 1);
    return { session_id: lease.id, session_token: lease.token, destination: lease.destination, expires_at: lease.expiresAt,
      sip: { username: lease.username, password: lease.password, realm: env.SIP_REALM, web,
        proxy: { host: env.SIP_SBC_HOST, port: env.SIP_SBC_PORT, transport: 'tls' }, srtp: 'required',
        codecs: ['opus', 'PCMA', 'PCMU'], register_expires_s: 60, stun_server: '', ice_enabled: true, expires_at: lease.expiresAt } };
  });
  app.delete<{ Params: { sessionId: string } }>('/public/api/video/sessions/:sessionId', async req => {
    // Allow cleanup even after a deployment disables new sessions.
    checkVideoOrigin(req.headers.origin, env.PUBLIC_BASE_URL);
    const match = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization ?? '');
    if (!match) throw new AppError(403, 'Video session capability required');
    await revokeVideoLease(req.params.sessionId, match[1]!);
    return { ok: true };
  });
}
