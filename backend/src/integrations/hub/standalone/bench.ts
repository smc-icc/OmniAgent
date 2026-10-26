/**
 * 压测基线：内存源 + log sink，不连真实 MySQL。
 *
 *   pnpm hub:bench -- --rate 3000 --seconds 5
 *   pnpm hub:bench -- --rate 3000 --seconds 600 --catchup --catchup-max 800
 *
 * 退出码：有 DLQ / failed 则为 2。
 */
import { loadHubConfig } from '../config/loader.js';
import { startHub } from '../runtime.js';
import { createMemoryCdcReader } from '../ingest/cdc.source.js';
import { EventTypes } from '../contract/event-types.js';
import type { CdcChange } from '../ingest/cdc-map.js';

function arg(name: string, fallback: string): string {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? String(process.argv[i + 1]) : fallback;
}

const rate = Number(arg('--rate', '3000'));
const seconds = Number(arg('--seconds', '5'));
const catchup = process.argv.includes('--catchup');
const catchupMax = Number(arg('--catchup-max', catchup ? '800' : '0'));

function change(seq: number): CdcChange {
  return {
    table: 't_icc_base_leaveword',
    op: 'insert',
    after: { ID: seq, Caller: '1000', LeaveWordFile: `b/${seq}.wav`, VDNId: 1 },
    cursor: { seq, gtid: `bench:${seq}` },
  };
}

async function main() {
  const config = loadHubConfig({
    HUB_ENABLED: '1',
    HUB_ROLE: 'standalone',
    HUB_INGEST: '1',
  });
  config.ingest.mode = 'cdc';
  config.ingest.cdc = {
    driver: 'native',
    serverId: 65535,
    pollIntervalMs: 1,
    idleMaxMs: 5,
    batchSize: 200,
    tables: {
      t_icc_base_leaveword: {
        insert: EventTypes.VOICEMAIL_CREATED,
        subjectId: 'ID',
        partitionKey: 'voicemail:{ID}',
      },
    },
  };
  config.sinks = { log: { kind: 'log' } };
  config.routes = [{
    name: 'all',
    match: { eventType: ['*'] },
    sinks: ['log'],
    transform: 'passthrough',
    onError: 'dlq',
  }];
  config.delivery.catchupMaxPerSec = catchupMax;

  const total = Math.max(1, Math.floor(rate * seconds));
  const reader = createMemoryCdcReader(
    catchup ? [] : Array.from({ length: total }, (_, i) => change(i + 1)),
  );
  const silent = {
    info() { /* bench */ },
    warn() { /* bench */ },
    error() { /* bench */ },
  };
  const t0 = Date.now();
  const hub = await startHub({ config, log: silent, cdcReader: reader });
  if (catchup) {
    for (let i = 1; i <= total; i++) reader.push(change(i));
  }
  const deadline = t0 + seconds * 1000 + Math.max(15_000, catchup ? Math.ceil(total / Math.max(catchupMax, 1)) * 1000 + 5_000 : 15_000);
  while (Date.now() < deadline) {
    const snap = hub.metrics.snapshot();
    if (snap.deliveredTotal >= total) break;
    await new Promise((r) => setTimeout(r, 20));
  }
  const elapsed = (Date.now() - t0) / 1000;
  const snap = hub.metrics.snapshot();
  await hub.stop();
  const out = {
    scenario: catchup ? 'catchup' : 'steady',
    events: total,
    delivered: snap.deliveredTotal,
    failed: snap.failedTotal,
    dlq: snap.dlqSize,
    seconds: elapsed,
    perSec: elapsed > 0 ? Math.round(snap.deliveredTotal / elapsed) : 0,
    catchupMaxPerSec: catchupMax,
    latencyP50Ms: snap.latencyP50Ms,
    latencyP95Ms: snap.latencyP95Ms,
    latencyP99Ms: snap.latencyP99Ms,
  };
  console.log(JSON.stringify(out, null, 2));
  if (snap.failedTotal > 0 || snap.dlqSize > 0 || snap.deliveredTotal < total) process.exit(2);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
