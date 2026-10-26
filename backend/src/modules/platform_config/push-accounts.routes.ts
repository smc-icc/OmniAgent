import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  sameSecret,
  PushAccountError,
  type PushAccountRuntime,
  type PushAccountSnapshot,
} from "../../shared/services/push-account-runtime.js";
const row = z
  .object({
    id: z.string().uuid(),
    provider: z.enum([
      "harmony",
      "fcm",
      "apns",
      "mipush",
      "hms",
      "oppo",
      "vivo",
      "honor",
    ]),
    name: z.string().min(1).max(100),
    bundle_id: z.string().min(2).max(255),
    enabled: z.boolean(),
    credentials: z.string().max(180000),
    updated_at: z.string().max(40),
  })
  .strict();
const snapshot = z
  .object({
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    accounts: z.array(row).max(100),
  })
  .strict();
const send = z
  .object({
    id: z.string().uuid(),
    token: z
      .string()
      .min(16)
      .max(4096)
      .refine((v) => !/[\r\n]/.test(v)),
    title: z.string().min(1).max(100).optional(),
    body: z.string().max(300).optional(),
  })
  .strict();
export function createPushAccountRoutes(
  runtime: PushAccountRuntime,
  getSecret: () => string,
) {
  return async function (app: FastifyInstance) {
    const authorize = async (req: any, reply: any) => {
      const secret = getSecret();
      if (!secret)
        return reply
          .code(503)
          .send({ error: "Push synchronization credential unavailable" });
      const token = req.headers["x-platform-sync-token"];
      if (typeof token !== "string" || !sameSecret(token, secret))
        return reply.code(401).send({ error: "Unauthorized" });
      reply.header("Cache-Control", "no-store");
    };
    app.get(
      "/api/platform-config/push-accounts",
      { preHandler: authorize },
      async (_req, reply) => {
        try {
          return await runtime.list();
        } catch {
          return reply
            .code(503)
            .send({ error: "Push configuration unavailable" });
        }
      },
    );
    app.post(
      "/api/platform-config/push-accounts/sync",
      { preHandler: authorize, bodyLimit: 1048576 },
      async (req, reply) => {
        const parsed = snapshot.safeParse(req.body);
        if (!parsed.success)
          return reply.code(400).send({ error: "Invalid push configuration" });
        try {
          return await runtime.synchronize(parsed.data as PushAccountSnapshot);
        } catch (e) {
          return reply
            .code(e instanceof PushAccountError ? e.statusCode : 503)
            .send({ error: "Push configuration sync rejected" });
        }
      },
    );
    app.post(
      "/api/platform-config/push-accounts/test",
      { preHandler: authorize },
      async (req, reply) => {
        const parsed = send.safeParse(req.body);
        if (!parsed.success)
          return reply.code(400).send({ error: "Invalid push test request" });
        try {
          return await runtime.test(parsed.data);
        } catch (e) {
          return reply
            .code(e instanceof PushAccountError ? e.statusCode : 503)
            .send({ error: "Push test failed" });
        }
      },
    );
  };
}
