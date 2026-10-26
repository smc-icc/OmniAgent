import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { MobileCallService, NativeCallEvent } from "./call-service.js";

const uuid = {
  type: "string",
  pattern:
    "^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$",
};
const params = {
  type: "object",
  required: ["attemptId"],
  additionalProperties: false,
  properties: { attemptId: uuid },
};
const generation = {
  type: "object",
  additionalProperties: false,
  required: ["runtimeId", "networkEpoch", "connectionGeneration"],
  properties: {
    runtimeId: { type: "string", pattern: "^[A-Za-z0-9-]{1,64}$" },
    networkEpoch: {
      type: "integer",
      minimum: 0,
      maximum: Number.MAX_SAFE_INTEGER,
    },
    connectionGeneration: {
      type: "integer",
      minimum: 1,
      maximum: Number.MAX_SAFE_INTEGER,
    },
  },
};
function capability(
  req: FastifyRequest,
  scheme: "MobileDevice" | "MobileCall",
): string {
  const header = req.headers.authorization;
  const match =
    typeof header === "string"
      ? new RegExp("^" + scheme + " ([A-Za-z0-9_-]{43})$").exec(header)
      : null;
  if (!match)
    throw Object.assign(new Error("mobile_authorization_denied"), {
      statusCode: 401,
    });
  return match[1];
}
async function result(reply: FastifyReply, run: () => Promise<unknown>) {
  reply.header("Cache-Control", "no-store");
  try {
    return await run();
  } catch (error) {
    const code = (error as Error).message;
    const denied = code === "mobile_authorization_denied";
    const conflict = [
      "offer_no_longer_current",
      "network_proof_stale",
      "registration_not_verified",
      "attempt_ended",
      "network_epoch_stale",
    ].includes(code);
    const invalid = [
      "native_event_not_allowed",
      "invalid_event_id",
      "invalid_network_context",
    ].includes(code);
    return reply
      .code(denied ? 401 : conflict ? 409 : invalid ? 400 : 503)
      .send({
        error:
          denied || conflict || invalid
            ? code
            : "mobile_call_service_unavailable",
      });
  }
}

/** Capability routes are registered only by a v2 deployment with live identity and CCS adapters. */
export async function mobileNativeCallRoutes(
  app: FastifyInstance,
  options: {
    service: Pick<MobileCallService, "bootstrap" | "nativeEvent" | "state">;
    enabled: boolean;
  },
): Promise<void> {
  app.addHook("onRequest", async (_req, reply) => {
    reply.header("Cache-Control", "no-store");
    if (!options.enabled)
      return reply.code(503).send({ error: "mobile_calling_v2_not_enabled" });
  });
  // Fastify's default AJV setup removes additional fields. Reject selectors before validation mutates them.
  app.addHook("preValidation", async (req, reply) => {
    if (
      req.method !== "POST" ||
      !req.body ||
      typeof req.body !== "object" ||
      Array.isArray(req.body)
    )
      return;
    const path = req.routeOptions.url ?? "";
    const allowed = path.endsWith("/bootstrap")
      ? ["runtimeId", "networkEpoch"]
      : path.endsWith("/events")
        ? ["eventId", "kind", "generation", "registrationId"]
        : ["eventId", "action", "generation"];
    if (Object.keys(req.body).some((key) => !allowed.includes(key)))
      return reply.code(400).send({ error: "unexpected_mobile_call_field" });
    const proof = (req.body as { generation?: unknown }).generation;
    if (
      proof &&
      typeof proof === "object" &&
      Object.keys(proof).some(
        (key) =>
          !["runtimeId", "networkEpoch", "connectionGeneration"].includes(key),
      )
    ) {
      return reply.code(400).send({ error: "unexpected_network_proof_field" });
    }
  });
  const rate = { rateLimit: { max: 120, timeWindow: 60000 } };
  app.post<{
    Params: { attemptId: string };
    Body: { runtimeId: string; networkEpoch: number };
  }>(
    "/api/mobile/calls/:attemptId/bootstrap",
    {
      bodyLimit: 2048,
      config: rate,
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["runtimeId", "networkEpoch"],
          properties: {
            runtimeId: { type: "string", pattern: "^[A-Za-z0-9-]{1,64}$" },
            networkEpoch: {
              type: "integer",
              minimum: 0,
              maximum: Number.MAX_SAFE_INTEGER,
            },
          },
        },
      },
    },
    async (req, reply) =>
      result(reply, () =>
        options.service.bootstrap(
          req.params.attemptId,
          capability(req, "MobileDevice"),
          req.body,
        ),
      ),
  );
  const eventProperties = {
    eventId: uuid,
    kind: { type: "string", enum: ["sip_ready", "connected"] },
    generation,
    registrationId: { type: "string", minLength: 1, maxLength: 128 },
  };
  app.post<{ Params: { attemptId: string }; Body: NativeCallEvent }>(
    "/api/mobile/calls/:attemptId/events",
    {
      bodyLimit: 4096,
      config: rate,
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["eventId", "kind", "generation"],
          properties: eventProperties,
        },
      },
    },
    async (req, reply) =>
      result(reply, () =>
        options.service.nativeEvent(
          req.params.attemptId,
          capability(req, "MobileCall"),
          req.body,
        ),
      ),
  );
  app.post<{
    Params: { attemptId: string };
    Body: {
      eventId: string;
      action: "accept" | "decline" | "end";
      generation: NativeCallEvent["generation"];
    };
  }>(
    "/api/mobile/calls/:attemptId/actions",
    {
      bodyLimit: 4096,
      config: rate,
      schema: {
        params,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["eventId", "action", "generation"],
          properties: {
            eventId: uuid,
            action: { type: "string", enum: ["accept", "decline", "end"] },
            generation,
          },
        },
      },
    },
    async (req, reply) =>
      result(reply, () =>
        options.service.nativeEvent(
          req.params.attemptId,
          capability(req, "MobileCall"),
          {
            eventId: req.body.eventId,
            kind: req.body.action,
            generation: req.body.generation,
          },
        ),
      ),
  );
  app.get<{ Params: { attemptId: string } }>(
    "/api/mobile/calls/:attemptId",
    {
      config: rate,
      schema: { params },
    },
    async (req, reply) =>
      result(reply, () =>
        options.service.state(
          req.params.attemptId,
          capability(req, "MobileCall"),
        ),
      ),
  );
}
