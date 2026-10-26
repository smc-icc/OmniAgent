import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { acceptEvent, isVersionSupported, getEventRegistration } from '../integrations/hub/contract/registry.js';
import { EventTypes, matchEventType } from '../integrations/hub/contract/event-types.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { hubConfigSchema } from '../integrations/hub/config/schema.js';
import { loadHubConfig } from '../integrations/hub/config/loader.js';
import { shouldRunIngest } from '../integrations/hub/runtime.js';
import { parseRestrictedYaml } from '../integrations/hub/config/yaml.js';
import { defaultHubConfig } from '../integrations/hub/config/defaults.js';
import { evalWhen, WhenExprError } from '../integrations/hub/core/when-expr.js';
import { routeEvent } from '../integrations/hub/core/router.js';
import { transformEvent, TransformError } from '../integrations/hub/core/transformer.js';
import { advanceLagWindowOffset, type OutboxRow } from '../integrations/hub/ingest/outbox.source.js';
import { createSocketIoSink } from '../integrations/hub/sinks/socketio.sink.js';

const dir = dirname(fileURLToPath(import.meta.url));

function sampleEvent(over: Partial<BusinessEvent> = {}): BusinessEvent {
  return {
    eventId: '00000000-0000-4000-8000-000000000001',
    eventType: EventTypes.VOICEMAIL_CREATED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ivr' },
    tenant: { vdnId: 1 },
    subject: { type: 'voicemail', id: '42' },
    partitionKey: 'voicemail:42',
    payload: { leavewordId: 42, callerNumber: '13800138000', duration: 12, fileName: 'leaveword/a.wav' },
    extraUnknown: 'keep-me',
    ...over,
  } as BusinessEvent;
}

describe('hub contract', () => {
  it('ignores unknown fields on accept', () => {
    const ev = sampleEvent();
    const accepted = acceptEvent(ev);
    expect((accepted as unknown as { extraUnknown?: string }).extraUnknown).toBe('keep-me');
    expect(accepted.eventType).toBe(EventTypes.VOICEMAIL_CREATED);
  });

  it('registers builtin versions and supports v1', () => {
    expect(getEventRegistration(EventTypes.VOICEMAIL_CREATED)?.currentVersion).toBe(1);
    expect(isVersionSupported(EventTypes.VOICEMAIL_CREATED, 1)).toBe(true);
  });

  it('matches event type globs', () => {
    expect(matchEventType('icc.voicemail.*', 'icc.voicemail.created')).toBe(true);
    expect(matchEventType('icc.voicemail.*', 'icc.call.ended')).toBe(false);
    expect(matchEventType('icc.*', 'icc.call.ended')).toBe(true);
  });
});

describe('hub config', () => {
  it('defaults keep hub disabled', () => {
    const cfg = loadHubConfig({ HUB_ENABLED: '0' });
    expect(cfg.enabled).toBe(false);
    expect(cfg.role).toBe('inline');
    expect(cfg.ingest.mode).toBe('outbox');
  });

  it('env overlays role and disabled sinks', () => {
    const cfg = loadHubConfig({ HUB_ENABLED: '1', HUB_ROLE: 'worker', HUB_SINKS_DISABLED: 'oracle,partner_http' });
    expect(cfg.enabled).toBe(true);
    expect(cfg.role).toBe('worker');
    expect(cfg.sinksDisabled).toEqual(['oracle', 'partner_http']);
    const vdn = loadHubConfig({ HUB_TEST_VDN: '12' });
    expect(vdn.reconcile.vdnIds).toEqual([12]);
    expect(vdn.reconcile.minute).toBe(30);
  });

  it('HUB_INGEST=0 disables ingest on inline; worker still ingests', () => {
    const api = loadHubConfig({ HUB_ENABLED: '1', HUB_ROLE: 'inline', HUB_INGEST: '0' });
    expect(api.runIngest).toBe(false);
    const worker = loadHubConfig({ HUB_ENABLED: '1', HUB_ROLE: 'worker', HUB_INGEST: '0' });
    expect(shouldRunIngest(worker)).toBe(true);
    expect(shouldRunIngest(api)).toBe(false);
  });

  it('rejects cdc mode without cdc config', () => {
    expect(() => hubConfigSchema.parse({ enabled: true, ingest: { mode: 'cdc' } })).toThrow();
  });

  it('parses hub.example.yaml', () => {
    const yamlPath = join(dir, '../integrations/hub/config/hub.example.yaml');
    const parsed = parseRestrictedYaml(readFileSync(yamlPath, 'utf8'));
    const cfg = hubConfigSchema.parse(parsed);
    expect(cfg.ingest.mode).toBe('outbox');
    expect(cfg.routes[0]?.name).toBe('voicemail-to-omni');
    expect(cfg.transforms.voicemail_to_omni.kind).toBe('mapping');
  });

  it('default config is valid', () => {
    expect(hubConfigSchema.parse(defaultHubConfig).routes.length).toBeGreaterThan(0);
  });
});

describe('hub when-expr', () => {
  it('evaluates comparisons and boolean ops', () => {
    expect(evalWhen('payload.duration >= 1', { payload: { duration: 12 } })).toBe(true);
    expect(evalWhen('payload.duration >= 1 && vdnId == 1', { payload: { duration: 12 }, vdnId: 1 })).toBe(true);
    expect(evalWhen('vdnId in [1, 2]', { vdnId: 2 })).toBe(true);
    expect(evalWhen('vdnId in [1, 2]', { vdnId: 9 })).toBe(false);
  });

  it('rejects injection-like expressions', () => {
    expect(() => evalWhen('payload.duration >= 1; process.exit(1)', { payload: { duration: 1 } })).toThrow(WhenExprError);
    expect(() => evalWhen('constructor.constructor("return 1")()', {})).toThrow(WhenExprError);
  });
});

describe('hub router / transformer', () => {
  it('routes voicemail events', () => {
    const hits = routeEvent(sampleEvent(), defaultHubConfig.routes);
    expect(hits.map((h) => h.route.name)).toContain('voicemail-to-omni');
    expect(routeEvent(sampleEvent({ eventType: EventTypes.CALL_ENDED }), defaultHubConfig.routes).map((h) => h.route.name))
      .toContain('call-ended-to-icc-pg');
  });

  it('maps voicemail fields', () => {
    const [row] = transformEvent(sampleEvent(), 'voicemail_to_omni', defaultHubConfig.transforms);
    expect(row.source_event_subject).toBe('42');
    expect(row.caller_number).toBe('13800138000');
    expect(row.duration_sec).toBe(12);
    expect(row.vdn_id).toBe(1);
  });

  it('fails closed on required missing fields', () => {
    const transforms = {
      need: {
        kind: 'mapping' as const,
        fields: { caller_number: { expr: '$.payload.missing', required: true } },
      },
    };
    expect(() => transformEvent(sampleEvent(), 'need', transforms)).toThrow(TransformError);
  });
});

describe('outbox lag window', () => {
  it('does not advance offset past a not-yet-visible lower id', () => {
    const now = new Date('2026-08-26T03:00:01.000Z');
    const row101: OutboxRow = {
      ID: 101,
      EventId: 'e101',
      EventType: EventTypes.CALL_ENDED,
      EventVersion: 1,
      AggregateType: 'call',
      AggregateId: 'c1',
      PartitionKey: 'call:c1',
      VdnId: 1,
      SourceComponent: 'ccs',
      Payload: {},
      OccurredAt: now,
      CreateTime: now,
    };
    const { emit, newOffset } = advanceLagWindowOffset({
      rows: [row101],
      offsetId: 99n,
      now,
      safetyLagMs: 1000,
    });
    expect(emit.map((r) => Number(r.ID))).toEqual([101]);
    expect(newOffset).toBe(99n);
  });

  it('advances after the hole row is older than safety lag', () => {
    const now = new Date('2026-08-26T03:00:05.000Z');
    const t100 = new Date('2026-08-26T03:00:01.000Z');
    const t101 = new Date('2026-08-26T03:00:01.100Z');
    const rows: OutboxRow[] = [100, 101].map((id, i) => ({
      ID: id,
      EventId: `e${id}`,
      EventType: EventTypes.CALL_ENDED,
      EventVersion: 1,
      AggregateType: 'call',
      AggregateId: 'c1',
      PartitionKey: 'call:c1',
      VdnId: 1,
      SourceComponent: 'ccs',
      Payload: {},
      OccurredAt: i === 0 ? t100 : t101,
      CreateTime: i === 0 ? t100 : t101,
    }));
    const { newOffset, emit } = advanceLagWindowOffset({
      rows,
      offsetId: 99n,
      now,
      safetyLagMs: 1000,
    });
    expect(emit).toHaveLength(2);
    expect(newOffset).toBe(101n);
  });
});

describe('hub socketio sink', () => {
  it('emits voicemail.created without touching Fastify', async () => {
    const emitted: Array<{ ev: string; payload: unknown }> = [];
    const sink = createSocketIoSink({
      emit: (ev, payload) => { emitted.push({ ev, payload }); },
    });
    const result = await sink.deliver([{
      event: sampleEvent(),
      record: {},
      sinkName: 'agent_ws',
    }]);
    expect(result.results[0]?.ok).toBe(true);
    expect(emitted[0]?.ev).toBe('voicemail.created');
    expect((emitted[0]?.payload as { leavewordId: string }).leavewordId).toBe('42');
  });
});
