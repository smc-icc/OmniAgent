import type { PrismaClient } from '@prisma/client';
import type { Pool } from 'mysql2/promise';
import type { HubConfig, HubIngestKind } from './config/schema.js';
import { isBusinessEvent } from './contract/event.js';
import { normalizeRaw } from './core/normalizer.js';
import { createDeliveryEngine, type DeliveryEngine } from './core/delivery-engine.js';
import { createCdcSource, type CdcReader } from './ingest/cdc.source.js';
import { createMysqlBinlogCdcReader } from './ingest/cdc-binlog.js';
import { createWatermarkCdcReader } from './ingest/cdc-watermark.js';
import { createLegacySyncSource } from './ingest/legacy-sync.source.js';
import { createMqSource, createRedisStreamConsumer, type MqConsumer, type RedisStreamClient } from './ingest/mq.source.js';
import { createOutboxSource, notImplementedSource } from './ingest/outbox.source.js';
import { createMysqlOutboxDb } from './ingest/mysql-db.js';
import { archiveOutbox, shouldRunDailyArchive, shouldRunDailyAt, localYmd, previousYmd, type ArchiveReport } from './admin/archive.js';
import { reconcileDay, type ReconcileReport } from './admin/reconcile.js';
import type { IngestSource } from './ingest/source.js';
import { createHubMetrics, type HubMetrics } from './observability/metrics.js';
import { createHttpSink } from './sinks/http.sink.js';
import { createLogSink } from './sinks/log.sink.js';
import { createPgVoicemailSink } from './sinks/pg.sink.js';
import { createPgUpsertSink, prismaPgExecutor, type PgExecutor } from './sinks/pg-upsert.js';
import { createOracleSink, type OracleExecutor } from './sinks/oracle.sink.js';
import { createMqSink, type MqPublisher } from './sinks/mq.sink.js';
import type { HubLogger, SinkAdapter } from './sinks/sink.js';
import { createTokenBucket } from './core/rate-limit.js';
import { createMemoryHubStore, type HubStore } from './store/memory.js';
import { createPrismaHubStore } from './store/prisma-store.js';

export interface HubHandle {
  config: HubConfig;
  metrics: HubMetrics;
  store: HubStore;
  replayDlq(id: number): Promise<{ ok: boolean; error?: string }>;
  replayDlqBySink(sink: string, limit?: number): Promise<{ replayed: number; failed: number }>;
  sinkHealth(): Promise<Record<string, { ok: boolean; detail?: string; circuitOpen: boolean }>>;
  archiveOutbox(): Promise<ArchiveReport>;
  reconcileNow(day?: string): Promise<ReconcileReport>;
  stop(): Promise<void>;
}

export interface HubDeps {
  config: HubConfig;
  log: HubLogger;
  prisma?: PrismaClient;
  mysql?: Pool | null;
  store?: HubStore;
  extraSinks?: SinkAdapter[];
  /** 真 binlog / Debezium / Canal 适配器；不注入且 native 时先 COM_BINLOG_DUMP，失败再水位。 */
  cdcReader?: CdcReader;
  mqConsumer?: MqConsumer;
  redis?: RedisStreamClient;
  oracleExecutor?: OracleExecutor;
  mqPublisher?: MqPublisher;
  pgExecutor?: PgExecutor;
}

export async function startHub(deps: HubDeps): Promise<HubHandle> {
  const { config, log } = deps;
  const metrics = createHubMetrics();
  const store = deps.store ?? (deps.prisma ? createPrismaHubStore(deps.prisma) : createMemoryHubStore());

  const extraByName = new Map((deps.extraSinks ?? []).map((s) => [s.name, s]));
  const sinks = new Map<string, SinkAdapter>();
  for (const [name, spec] of Object.entries(config.sinks)) {
    if (config.sinksDisabled.includes(name)) continue;
    if (spec.kind === 'log') sinks.set(name, createLogSink(log, name));
    else if (spec.kind === 'pg') {
      const table = spec.table?.trim() ?? '';
      if (table === 'icc_voicemails') {
        if (deps.prisma) sinks.set(name, createPgVoicemailSink(deps.prisma, name));
        else log.warn({ sink: name }, 'pg voicemail sink skipped: no prisma');
      } else {
        const executor = deps.pgExecutor ?? (deps.prisma ? prismaPgExecutor(deps.prisma) : undefined);
        if (!executor) {
          log.warn({ sink: name }, 'pg upsert sink skipped: no prisma/pgExecutor');
        } else {
          sinks.set(name, createPgUpsertSink({ spec, name, executor }));
        }
      }
    } else if (spec.kind === 'http') {
      try {
        sinks.set(name, createHttpSink(spec, name));
      } catch (err) {
        log.warn({ sink: name, err: err instanceof Error ? err.message : String(err) }, 'http sink 初始化失败，已跳过');
      }
    } else if (spec.kind === 'oracle') {
      try {
        const sink = createOracleSink({ spec, name, executor: deps.oracleExecutor });
        await sink.init();
        sinks.set(name, sink);
      } catch (err) {
        log.warn({ sink: name, err: err instanceof Error ? err.message : String(err) }, 'oracle sink 初始化失败，已跳过');
      }
    } else if (spec.kind === 'mq') {
      try {
        const sink = createMqSink({ spec, name, publisher: deps.mqPublisher });
        await sink.init();
        sinks.set(name, sink);
      } catch (err) {
        log.warn({ sink: name, err: err instanceof Error ? err.message : String(err) }, 'mq sink 初始化失败，已跳过');
      }
    } else if (spec.kind === 'internal-socketio') {
      const extra = extraByName.get(name);
      if (extra) sinks.set(name, extra);
      else log.warn({ sink: name }, 'internal-socketio 仅 inline/worker 注册，standalone 请改用 http omni_notify');
    } else {
      log.warn({ sink: name, kind: spec.kind }, 'sink kind 尚未实现，已跳过');
    }
  }
  for (const s of extraByName.values()) {
    if (!sinks.has(s.name)) sinks.set(s.name, s);
  }
  for (const s of sinks.values()) await s.init();

  const engine = createDeliveryEngine({ config, store, sinks, log, metrics });

  const sources: IngestSource[] = [];
  if (shouldRunIngest(config)) {
    const kinds = resolveIngestKinds(config);
    for (const kind of kinds) {
      if (kind === 'outbox') {
        if (!deps.mysql) {
          log.warn({}, 'ingest.mode=outbox 但 MySQL 池不可用，跳过摄取');
          continue;
        }
        const db = createMysqlOutboxDb(deps.mysql);
        sources.push(createOutboxSource({
          db,
          config: config.ingest.outbox,
          getOffset: async () => {
            const cur = await store.getOffset('outbox');
            return BigInt((cur?.id as string | number | undefined) ?? 0);
          },
          setOffset: async (id) => { await store.setOffset('outbox', { id: id.toString() }); },
          shouldPause: () => engine.pauseIngest(),
          onHealth: (h) => {
            metrics.setOutboxBacklog(h.backlog ?? 0);
            metrics.setOldestUnconsumedSeconds(h.oldestSeconds ?? 0);
            metrics.setLagSeconds(h.oldestSeconds ?? 0);
          },
        }));
      } else if (kind === 'cdc') {
        const cdcCfg = config.ingest.cdc;
        if (!cdcCfg) {
          log.warn({}, 'ingest.cdc 缺失，跳过');
          continue;
        }
        let reader = deps.cdcReader;
        if (!reader && cdcCfg.driver === 'native') {
          try {
            reader = await createMysqlBinlogCdcReader({ config: cdcCfg, log });
            log.info({ driver: 'native' }, 'cdc native: 已连接 MySQL ROW binlog dump');
          } catch (err) {
            log.warn(
              { err: err instanceof Error ? err.message : String(err) },
              'cdc native: binlog dump 失败，回退表主键水位（仅 INSERT）',
            );
            if (deps.mysql) {
              reader = createWatermarkCdcReader({
                db: createMysqlOutboxDb(deps.mysql),
                config: cdcCfg,
                getOffset: () => store.getOffset('cdc'),
              });
            }
          }
        }
        if (!reader) {
          log.warn({ driver: cdcCfg.driver }, 'cdc 摄取未就绪（需要注入 cdcReader，或 native + MySQL），已跳过');
          continue;
        }
        sources.push(createCdcSource({
          reader,
          config: cdcCfg,
          getOffset: () => store.getOffset('cdc'),
          setOffset: (cursor) => store.setOffset('cdc', cursor),
          shouldPause: () => engine.pauseIngest(),
        }));
      } else if (kind === 'mq') {
        const mqCfg = config.ingest.mq;
        if (!mqCfg) {
          log.warn({}, 'ingest.mq 缺失，跳过');
          continue;
        }
        let consumer = deps.mqConsumer;
        if (!consumer) {
          if (mqCfg.driver !== 'redis-streams') {
            log.warn({ driver: mqCfg.driver }, 'mq driver 未实现，已跳过（可注入 mqConsumer）');
            continue;
          }
          try {
            consumer = await createRedisStreamConsumer({ config: mqCfg, redis: deps.redis });
          } catch (err) {
            log.warn({ err: err instanceof Error ? err.message : String(err) }, 'mq redis-streams 初始化失败，已跳过');
            continue;
          }
        }
        sources.push(createMqSource({
          consumer,
          config: mqCfg,
          shouldPause: () => engine.pauseIngest(),
        }));
      } else if (kind === 'legacy_sync') {
        const lsCfg = config.ingest.legacy_sync;
        if (!lsCfg) {
          log.warn({}, 'ingest.legacy_sync 缺失，跳过');
          continue;
        }
        if (!deps.mysql) {
          log.warn({}, 'legacy_sync 需要 MySQL 池，已跳过');
          continue;
        }
        try {
          sources.push(createLegacySyncSource({
            db: createMysqlOutboxDb(deps.mysql),
            config: lsCfg,
            getOffset: () => store.getOffset('legacy_sync'),
            setOffset: (cursor) => store.setOffset('legacy_sync', cursor),
            shouldPause: () => engine.pauseIngest(),
          }));
        } catch (err) {
          log.warn({ err: err instanceof Error ? err.message : String(err) }, 'legacy_sync 初始化失败，已跳过');
        }
      } else {
        sources.push(notImplementedSource(kind));
      }
    }

    const limiter = createTokenBucket(config.delivery.catchupMaxPerSec);
    for (const src of sources) {
      await src.start(async (raws) => {
        for (const raw of raws) {
          await limiter.take();
          const event = normalizeRaw(raw);
          await engine.submit(event);
          await src.commit(raw.cursor);
        }
      });
    }
  }

  log.info({
    role: config.role,
    ingest: shouldRunIngest(config) ? config.ingest.mode : 'off',
    sinks: [...sinks.keys()],
  }, 'ICC Integration Hub started');

  async function replayDlq(id: number): Promise<{ ok: boolean; error?: string }> {
    const row = await store.getDlq(id);
    if (!row) return { ok: false, error: 'dlq not found' };
    if (row.replayedAt) return { ok: false, error: 'already replayed' };
    if (!isBusinessEvent(row.event)) return { ok: false, error: 'invalid event payload' };
    try {
      await engine.replayToSink(row.event, row.sink);
      const d = await store.getDelivery(row.event.eventId, row.sink);
      if (d?.status !== 'succeeded') {
        return { ok: false, error: d?.lastError ?? 'replay failed' };
      }
      await store.markDlqReplayed(id);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  }

  const mysqlDb = deps.mysql ? createMysqlOutboxDb(deps.mysql) : undefined;
  let lastArchiveYmd: string | null = null;
  async function runArchive(): Promise<ArchiveReport> {
    if (!mysqlDb) {
      return {
        scanned: 0,
        archived: 0,
        skippedNotSucceeded: 0,
        skippedNoDelivery: 0,
        archivePurged: 0,
        errors: ['mysql unavailable'],
      };
    }
    return archiveOutbox({
      db: mysqlDb,
      store,
      retentionDays: config.ingest.outbox.retentionDays,
      batchSize: config.ingest.outbox.archiveBatchSize,
      log,
    });
  }
  const archiveTimer = mysqlDb
    ? setInterval(() => {
      const now = new Date();
      if (!shouldRunDailyArchive(now, config.ingest.outbox.archiveHour, lastArchiveYmd)) return;
      lastArchiveYmd = localYmd(now);
      void runArchive().catch((err) => {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'hub outbox archive failed');
      });
    }, 60_000)
    : undefined;

  let lastReconcileYmd: string | null = null;
  async function runReconcile(day?: string): Promise<ReconcileReport> {
    if (!mysqlDb) {
      return {
        day: day ?? previousYmd(new Date()),
        leaveword: { src: 0, dst: 0, missing: 0 },
        callLog: { src: 0, dst: 0, missing: 0 },
        agRoute: { src: 0, dst: 0, missing: 0 },
        stateTrk: { src: 0, dst: 0, missing: 0 },
        login: { src: 0, dst: 0, missing: 0 },
        cdr: { src: 0, dst: 0, missing: 0 },
        acdRoute: { src: 0, dst: 0, missing: 0 },
        ivrRoute: { src: 0, dst: 0, missing: 0 },
        ivrTrace: { src: 0, dst: 0, missing: 0 },
        dlqInserted: 0,
      };
    }
    const vdnIds = config.reconcile.vdnIds;
    if (!vdnIds.length) {
      log.warn({}, 'hub reconcile 未限制 VDN；灰度请设 HUB_TEST_VDN 或 HUB_RECONCILE_VDNS，避免全库灌 DLQ');
    }
    return reconcileDay({
      mysql: mysqlDb,
      store,
      prisma: deps.prisma,
      day: day ?? previousYmd(new Date()),
      sink: config.reconcile.sink,
      vdnIds,
      log,
    });
  }
  const reconcileTimer = mysqlDb
    ? setInterval(() => {
      const now = new Date();
      if (!shouldRunDailyAt(now, config.reconcile.hour, config.reconcile.minute, lastReconcileYmd)) return;
      lastReconcileYmd = localYmd(now);
      void runReconcile().catch((err) => {
        log.error({ err: err instanceof Error ? err.message : String(err) }, 'hub reconcile failed');
      });
    }, 60_000)
    : undefined;

  return {
    config,
    metrics,
    store,
    replayDlq,
    async replayDlqBySink(sink, limit = 50) {
      const rows = await store.listDlq({ sink, limit });
      let replayed = 0;
      let failed = 0;
      for (const row of rows) {
        if (row.id == null) continue;
        const r = await replayDlq(row.id);
        if (r.ok) replayed += 1;
        else failed += 1;
      }
      return { replayed, failed };
    },
    async sinkHealth() {
      const out: Record<string, { ok: boolean; detail?: string; circuitOpen: boolean }> = {};
      for (const [name, sink] of sinks) {
        const h = await sink.health();
        out[name] = { ...h, circuitOpen: engine.isCircuitOpen(name) };
      }
      return out;
    },
    archiveOutbox: runArchive,
    reconcileNow: runReconcile,
    async stop() {
      if (archiveTimer) clearInterval(archiveTimer);
      if (reconcileTimer) clearInterval(reconcileTimer);
      for (const src of sources) await src.stop();
      await engine.drain();
      await engine.close();
      for (const s of sinks.values()) await s.close();
    },
  };
}

/** worker/standalone 强制摄取；inline 可用 HUB_INGEST=0 让 API 进程不跑轮询。 */
export function shouldRunIngest(config: HubConfig): boolean {
  if (config.role === 'worker' || config.role === 'standalone') return true;
  return config.runIngest !== false;
}

export function resolveIngestKinds(config: HubConfig): HubIngestKind[] {
  if (config.ingest.mode === 'multi') {
    return (config.ingest.multi ?? []).filter((m) => m.enabled).map((m) => m.kind);
  }
  return [config.ingest.mode];
}

export type { DeliveryEngine };
