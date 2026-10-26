import type { Job } from 'bullmq';
import type { WebhookJob } from './types.js';
import { prisma } from './prisma.js';

/**
 * Webhook queue processor — dispatches webhooks to external endpoints.
 *
 * Supports two job shapes:
 * 1. Direct: { url, event, payload, headers }
 * 2. Account event: { account_id, conversation_id?, message_id? } with job.name = event type
 */

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = [1000, 5000, 15000];

function parseSubscriptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.filter((s): s is string => typeof s === 'string');
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed.filter((s): s is string => typeof s === 'string') : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function buildEventPayload(eventName: string, data: WebhookJob): Promise<unknown> {
  if (data.payload !== undefined) return data.payload;

  if (eventName === 'message_created' && data.message_id) {
    const msg = await prisma.messages.findUnique({
      where: { id: data.message_id },
    });
    if (msg) {
      return {
        event: eventName,
        account: { id: data.account_id },
        id: msg.id,
        content: msg.content,
        message_type: msg.message_type,
        content_type: msg.content_type,
        conversation_id: msg.conversation_id,
        inbox_id: msg.inbox_id,
        created_at: msg.created_at,
      };
    }
  }

  return {
    event: eventName,
    account_id: data.account_id,
    conversation_id: data.conversation_id,
    message_id: data.message_id,
  };
}

async function postWithRetry(
  url: string,
  body: unknown,
  headers: Record<string, string> = {},
  attempt: number = 0,
): Promise<{ status: number; ok: boolean }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'OmniAgent-Webhook/1.0',
        ...headers,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    if (!response.ok && attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS[attempt] ?? 15000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return postWithRetry(url, body, headers, attempt + 1);
    }

    return { status: response.status, ok: response.ok };
  } catch (err) {
    clearTimeout(timeout);
    if (attempt < MAX_RETRIES) {
      const delay = RETRY_DELAY_MS[attempt] ?? 15000;
      await new Promise((resolve) => setTimeout(resolve, delay));
      return postWithRetry(url, body, headers, attempt + 1);
    }
    throw err;
  }
}

async function dispatchToAccountWebhooks(
  eventName: string,
  data: WebhookJob,
): Promise<{ dispatched: boolean; url: string }> {
  const accountId = data.account_id;
  if (!accountId) {
    return { dispatched: false, url: '' };
  }

  const hooks = await prisma.webhooks.findMany({
    where: { account_id: accountId },
  });

  const targets = hooks.filter((hook) => {
    const targetUrl = hook.url?.trim();
    if (!targetUrl) return false;
    return parseSubscriptions(hook.subscriptions).includes(eventName);
  });

  if (!targets.length) {
    return { dispatched: false, url: '' };
  }

  const payload = await buildEventPayload(eventName, data);
  const urls: string[] = [];

  for (const hook of targets) {
    const url = hook.url!.trim();
    urls.push(url);
    await postWithRetry(url, payload, {});
  }

  return { dispatched: true, url: urls.join(',') };
}

export async function webhookProcessor(job: Job): Promise<{ dispatched: boolean; url: string; event: string }> {
  const data = job.data as WebhookJob;
  const eventName = data.event ?? job.name;

  if (data.url?.trim()) {
    const result = await postWithRetry(
      data.url.trim(),
      data.payload ?? data,
      data.headers ?? {},
    );
    return { dispatched: result.ok, url: data.url, event: eventName };
  }

  const accountResult = await dispatchToAccountWebhooks(eventName, data);
  return { dispatched: accountResult.dispatched, url: accountResult.url, event: eventName };
}
