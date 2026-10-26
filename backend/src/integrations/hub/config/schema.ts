import { z } from 'zod';

const boolish = z.preprocess((v) => {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());
  if (typeof v === 'number') return v !== 0;
  return v;
}, z.boolean());

export const hubRoleSchema = z.enum(['inline', 'worker', 'standalone']);

export const ingestKindSchema = z.enum(['outbox', 'cdc', 'mq', 'legacy_sync']);

const outboxSchema = z.object({
  pollIntervalMs: z.number().int().positive().default(50),
  idleMaxMs: z.number().int().positive().default(500),
  batchSize: z.number().int().positive().default(200),
  safetyLagMs: z.number().int().positive().default(1000),
  claimTimeoutMs: z.number().int().positive().default(120_000),
  mysql8: z.boolean().optional(),
  retentionDays: z.number().int().positive().default(7),
  archiveHour: z.number().int().min(0).max(23).default(3),
  archiveBatchSize: z.number().int().positive().default(500),
  backlogAlertRows: z.number().int().positive().default(100_000),
  backlogAlertSeconds: z.number().int().positive().default(300),
});

const cdcTableSchema = z.object({
  insert: z.string().optional(),
  update: z.string().optional(),
  delete: z.string().optional(),
  subjectId: z.string(),
  partitionKey: z.string().optional(),
});

const cdcSchema = z.object({
  driver: z.enum(['native', 'debezium', 'canal']).default('native'),
  serverId: z.number().int().positive().default(65535),
  tables: z.record(cdcTableSchema).default({}),
  pollIntervalMs: z.number().int().positive().default(50),
  idleMaxMs: z.number().int().positive().default(500),
  batchSize: z.number().int().positive().default(200),
  host: z.string().optional(),
  port: z.number().int().positive().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  database: z.string().optional(),
});

const mqIngestSchema = z.object({
  driver: z.enum(['redis-streams', 'kafka', 'rabbitmq']).default('redis-streams'),
  url: z.string().optional(),
  topics: z.array(z.string()).default(['icc.events']),
  consumerGroup: z.string().default('icc-hub'),
  consumerName: z.string().default('icc-hub'),
  maxInFlight: z.number().int().positive().default(100),
  blockMs: z.number().int().nonnegative().default(50),
  claimIdleMs: z.number().int().positive().default(120_000),
  ackMode: z.enum(['after-delivery']).default('after-delivery'),
});

const legacySyncTableSchema = z.object({
  lookup: z.string(),
  eventType: z.string(),
  deleteAfterRead: z.boolean().default(true),
});

const legacySyncSchema = z.object({
  tables: z.record(legacySyncTableSchema).default({}),
  pollIntervalMs: z.number().int().positive().default(50),
  idleMaxMs: z.number().int().positive().default(500),
  batchSize: z.number().int().positive().default(200),
});

const ingestMultiItemSchema = z.object({
  kind: ingestKindSchema,
  enabled: z.boolean().default(true),
});

const ingestSchema = z.object({
  mode: z.enum(['outbox', 'cdc', 'mq', 'legacy_sync', 'multi']).default('outbox'),
  outbox: outboxSchema.default({}),
  cdc: cdcSchema.optional(),
  mq: mqIngestSchema.optional(),
  legacy_sync: legacySyncSchema.optional(),
  multi: z.array(ingestMultiItemSchema).optional(),
}).superRefine((val, ctx) => {
  if (val.mode === 'multi' && (!val.multi || val.multi.length === 0)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ingest.mode=multi 时必须提供 ingest.multi', path: ['multi'] });
  }
  const enabledKinds = val.mode === 'multi'
    ? (val.multi ?? []).filter((m) => m.enabled).map((m) => m.kind)
    : [val.mode];
  if (enabledKinds.includes('cdc') && !val.cdc) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ingest.mode=cdc 时必须提供 ingest.cdc', path: ['cdc'] });
  }
  if (enabledKinds.includes('mq') && !val.mq?.url) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ingest.mode=mq 时必须提供 ingest.mq.url', path: ['mq', 'url'] });
  }
  if (enabledKinds.includes('legacy_sync') && !val.legacy_sync) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'ingest.mode=legacy_sync 时必须提供 ingest.legacy_sync', path: ['legacy_sync'] });
  }
});

const routeMatchSchema = z.object({
  eventType: z.array(z.string()).optional(),
  vdnId: z.array(z.number().int()).optional(),
  when: z.string().optional(),
});

const routeSchema = z.object({
  name: z.string().min(1),
  match: routeMatchSchema.default({}),
  sinks: z.array(z.string()).min(1),
  transform: z.string().default('passthrough'),
  onError: z.enum(['dlq', 'drop', 'pause']).default('dlq'),
});

const mappingFieldSchema = z.union([
  z.string(),
  z.object({
    expr: z.string(),
    cast: z.string().optional(),
    default: z.unknown().optional(),
    required: z.boolean().optional(),
  }),
]);

const transformSchema = z.object({
  kind: z.enum(['mapping', 'module', 'passthrough']).default('passthrough'),
  target: z.object({
    table: z.string().optional(),
    conflictKey: z.array(z.string()).optional(),
  }).optional(),
  fields: z.record(mappingFieldSchema).optional(),
  /** 把 payload 键转小写写入行（镜像 t_icc_* 列名）。 */
  fromPayload: z.boolean().optional(),
  module: z.string().optional(),
});

const sinkKindSchema = z.enum(['pg', 'oracle', 'http', 'mq', 'log', 'internal-socketio']);

const sinkSchema = z.object({
  kind: sinkKindSchema,
  url: z.string().optional(),
  schema: z.string().optional(),
  connectString: z.string().optional(),
  user: z.string().optional(),
  password: z.string().optional(),
  method: z.string().optional(),
  timeoutMs: z.number().int().positive().optional(),
  signing: z.object({
    algorithm: z.string(),
    secret: z.string(),
    header: z.string().optional(),
  }).optional(),
  headers: z.record(z.string()).optional(),
  batch: z.object({
    maxSize: z.number().int().positive().optional(),
    maxWaitMs: z.number().int().nonnegative().optional(),
  }).optional(),
  room: z.string().optional(),
  table: z.string().optional(),
  allowPrivate: z.boolean().optional(),
  allowHosts: z.array(z.string()).optional(),
  driver: z.string().optional(),
  partitions: z.number().int().positive().optional(),
  topic: z.string().optional(),
  conflictKey: z.array(z.string()).optional(),
});

const deliverySchema = z.object({
  laneCount: z.number().int().positive().default(16),
  maxAttempts: z.number().int().positive().default(8),
  retryBaseMs: z.number().int().positive().default(1000),
  retryMaxMs: z.number().int().positive().default(300_000),
  circuitFailureThreshold: z.number().int().positive().default(8),
  circuitOpenMs: z.number().int().positive().default(30_000),
  unroutedToDlq: z.boolean().default(false),
  catchupMaxPerSec: z.number().int().nonnegative().default(0),
});

const reconcileSchema = z.object({
  hour: z.number().int().min(0).max(23).default(3),
  minute: z.number().int().min(0).max(59).default(30),
  vdnIds: z.array(z.number().int()).default([]),
  sink: z.string().min(1).default('omni_pg'),
});

export const hubConfigSchema = z.object({
  enabled: boolish.default(false),
  role: hubRoleSchema.default('inline'),
  runIngest: boolish.default(true),
  sinksDisabled: z.array(z.string()).default([]),
  ingest: ingestSchema.default({}),
  routes: z.array(routeSchema).default([]),
  transforms: z.record(transformSchema).default({}),
  sinks: z.record(sinkSchema).default({}),
  delivery: deliverySchema.default({}),
  reconcile: reconcileSchema.default({}),
});

export type HubConfig = z.infer<typeof hubConfigSchema>;
export type HubRouteConfig = z.infer<typeof routeSchema>;
export type HubTransformConfig = z.infer<typeof transformSchema>;
export type HubSinkConfig = z.infer<typeof sinkSchema>;
export type HubOutboxConfig = z.infer<typeof outboxSchema>;
export type HubCdcConfig = z.infer<typeof cdcSchema>;
export type HubCdcTableConfig = z.infer<typeof cdcTableSchema>;
export type HubMqIngestConfig = z.infer<typeof mqIngestSchema>;
export type HubLegacySyncConfig = z.infer<typeof legacySyncSchema>;
export type HubLegacySyncTableConfig = z.infer<typeof legacySyncTableSchema>;
export type HubIngestKind = z.infer<typeof ingestKindSchema>;
