import type { FastifyInstance } from 'fastify';
import {
  wechatMpWebhookVerify,
  wechatMpWebhookProcess,
  wechatOauthCallback,
  wecomKfWebhookVerify,
  wecomKfWebhookProcess,
  wecomContactWebhookVerify,
  wecomContactWebhookProcess,
} from './wechat.controller.js';

/** Webhook-only routes; channel CRUD lives in ConfServer integrations UI. */
export async function wechatRoutes(fastify: FastifyInstance) {
  fastify.get('/webhooks/wechat/mp/:app_id', wechatMpWebhookVerify);
  fastify.post('/webhooks/wechat/mp/:app_id', wechatMpWebhookProcess);
  fastify.get('/webhooks/wechat/oauth', wechatOauthCallback);

  fastify.get('/webhooks/wecom/kf/:channel_id', wecomKfWebhookVerify);
  fastify.post('/webhooks/wecom/kf/:channel_id', wecomKfWebhookProcess);

  fastify.get('/webhooks/wecom/contact/:channel_id', wecomContactWebhookVerify);
  fastify.post('/webhooks/wecom/contact/:channel_id', wecomContactWebhookProcess);
}
