import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';
import { deriveItrWsUrl } from './itr-observe-url.js';
import { connectObserveWs } from './itr-observe-net.js';

export { deriveItrWsUrl } from './itr-observe-url.js';

const EVENT = 'itr.observe';

export type ItrObserveEvent = {
  ts?: number;
  event: string;
  conversationId?: string;
  flowId?: number;
  nodeId?: string;
  nodeType?: string;
  state?: string;
  preview?: string;
  message?: string;
  code?: string;
  role?: string;
};

const RING = 120;
const recent: ItrObserveEvent[] = [];

let conn: { close: () => void } | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let stopped = false;
let delayMs = 1500;

export function getItrObserveRecent(limit = 50): ItrObserveEvent[] {
  const n = Math.max(1, Math.min(limit, RING));
  return recent.slice(-n);
}

export function startItrObserveClient(fastify: FastifyInstance): void {
  if (!env.ITR_WS_ENABLE) {
    fastify.log.info('ITR observe WS disabled');
    return;
  }
  stopped = false;
  connect(fastify);
  fastify.addHook('onClose', async () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    timer = null;
    conn?.close();
    conn = null;
  });
}

function push(fastify: FastifyInstance, evt: ItrObserveEvent) {
  recent.push(evt);
  if (recent.length > RING) recent.splice(0, recent.length - RING);
  try {
    fastify.emitToAll(EVENT, evt);
  } catch {
    fastify.io?.emit(EVENT, evt);
  }
}

function connect(fastify: FastifyInstance) {
  if (stopped) return;
  const url = deriveItrWsUrl(env.ITR_HTTP_BASE, env.ITR_WS_URL);
  fastify.log.info({ url }, 'ITR observe WS connecting');
  try {
    conn = connectObserveWs(url, {
      onOpen: () => {
        delayMs = 1500;
        fastify.log.info({ url }, 'ITR observe WS connected');
      },
      onMessage: (raw) => {
        try {
          const evt = JSON.parse(raw) as ItrObserveEvent;
          if (!evt || typeof evt.event !== 'string') return;
          push(fastify, evt);
        } catch {
          /* ignore non-json */
        }
      },
      onClose: () => {
        conn = null;
        schedule(fastify);
      },
    });
  } catch (err) {
    fastify.log.warn({ err, url }, 'ITR observe WS construct failed');
    schedule(fastify);
  }
}

function schedule(fastify: FastifyInstance) {
  if (stopped) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => connect(fastify), delayMs);
  delayMs = Math.min(delayMs * 2, 15000);
}
