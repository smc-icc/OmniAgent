import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventTypes } from '../integrations/hub/contract/event-types.js';
import type { BusinessEvent } from '../integrations/hub/contract/event.js';
import { defaultHubConfig } from '../integrations/hub/config/defaults.js';
import { transformEvent } from '../integrations/hub/core/transformer.js';
import {
  buildPgUpsertSql,
  createPgUpsertSink,
  pickMirrorRow,
  type PgExecutor,
} from '../integrations/hub/sinks/pg-upsert.js';
import { HubDeliveryError } from '../integrations/hub/core/errors.js';

function callEvent(pid: string): BusinessEvent {
  return {
    eventId: '00000000-0000-4000-8000-0000000000aa',
    eventType: EventTypes.CALL_ENDED,
    eventVersion: 1,
    occurredAt: '2026-08-26T03:00:00.000Z',
    source: { system: 'icc', component: 'ccs' },
    tenant: { vdnId: 1 },
    subject: { type: 'call', id: pid },
    partitionKey: `call:${pid}`,
    payload: {
      pid,
      callingNo: '13800138000',
      callerNumber: '13800138000',
      calledNo: '1000',
      talkTimeLong: 11,
      duration: 11,
      callDirection: 1,
      callType: 1,
      beginTime: '2026-08-26T03:00:00Z',
    },
  };
}

describe('icc pg mirror upsert', () => {
  it('builds INSERT ON CONFLICT for allowlisted table', () => {
    const { sql } = buildPgUpsertSql({
      schema: 'icc',
      table: 't_icc_base_call_log',
      columns: ['pid', 'callingno', 'talktimelong'],
      conflictKey: ['pid'],
    });
    expect(sql).toContain('INSERT INTO "icc"."t_icc_base_call_log"');
    expect(sql).toContain('ON CONFLICT ("pid")');
    expect(sql).toContain('DO UPDATE SET');
    expect(sql).toContain('$1::bigint');
  });

  it('coerces string parentcallpid onto bigint placeholder', () => {
    const picked = pickMirrorRow('t_icc_ag_state_trk_record', {
      id: 471,
      agentid: 10599,
      parentcallpid: '-1',
      consn: null,
    });
    expect(picked.row.id).toBe('471');
    expect(picked.row.parentcallpid).toBe('-1');
    expect(picked.row.consn).toBeNull();
    const { sql } = buildPgUpsertSql({
      schema: 'icc',
      table: picked.table,
      columns: Object.keys(picked.row),
      conflictKey: ['id'],
    });
    expect(sql).toMatch(/\$1::bigint/);
    expect(sql).toContain('parentcallpid');
  });

  it('maps fromPayload aliases onto mirror columns', () => {
    const [row] = transformEvent(callEvent('749592929969909760'), 'call_ended_to_icc', defaultHubConfig.transforms);
    expect(row.__hub_table).toBe('t_icc_base_call_log');
    expect(row.pid).toBe('749592929969909760');
    expect(row.callingno).toBe('13800138000');
    expect(row.calledno).toBe('1000');
    expect(row.talktimelong).toBe(11);
    const picked = pickMirrorRow(String(row.__hub_table), row);
    expect(picked.table).toBe('t_icc_base_call_log');
    expect(picked.row.callernumber).toBeUndefined();
  });

  it('rejects tables outside the mirror allowlist', () => {
    expect(() => pickMirrorRow('t_user_users', { pid: 1 })).toThrow(HubDeliveryError);
  });

  it('upserts via injected executor', async () => {
    const seen: Array<{ sql: string; params: unknown[] }> = [];
    const executor: PgExecutor = {
      async execute(sql, params) { seen.push({ sql, params }); },
      async ping() { /* */ },
      async close() { /* */ },
    };
    const sink = createPgUpsertSink({
      spec: { kind: 'pg', schema: 'icc', table: 't_icc_base_call_log', conflictKey: ['pid'] },
      name: 'icc_call_log',
      executor,
    });
    await sink.init();
    const [row] = transformEvent(callEvent('42'), 'call_ended_to_icc', defaultHubConfig.transforms);
    const result = await sink.deliver([{
      event: callEvent('42'),
      record: row,
      sinkName: 'icc_call_log',
    }]);
    expect(result.results[0]?.ok).toBe(true);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sql).toContain('t_icc_base_call_log');
    expect(seen[0]?.params).toContain('42');
  });
});

describe('icc report views', () => {
  it('matches ICIP inbound/outbound stored-proc shape', () => {
    const sql = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), '../integrations/hub/sql/icc.schema.sql'),
      'utf8',
    );
    expect(sql).toContain('首次呼入-转出');
    expect(sql).toContain('v_rpt_agent_outbound_detail');
    expect(sql).toContain('icc.v_rpt_platform_inbound_kpi');
    expect(sql).toContain('v_rpt_agent_work_efficiency');
    expect(sql).toContain('v_rpt_ivr_access');
    expect(sql).toContain('t_icc_ag_login_log');
    expect(sql).toContain('t_icc_ivr_trace_log');
    expect(sql).toContain('v_rpt_full_media_access');
    expect(sql).toContain('v_rpt_relay_utilization');
    expect(sql).toContain('v_rpt_customer_by_region');
    expect(sql).toContain('v_rpt_pa_efficiency');
    expect(sql).toContain('CREATE ROLE icc_rpt LOGIN');
  });

  it('requires id for state_trk mirror rows', () => {
    expect(() => pickMirrorRow('t_icc_ag_state_trk_record', { agentid: 1 })).toThrow(/缺少 id/);
    const picked = pickMirrorRow('t_icc_ag_state_trk_record', { id: 9, agentid: 1, status: 32 });
    expect(picked.table).toBe('t_icc_ag_state_trk_record');
    expect(picked.row.id).toBe('9');
  });

  it('maps thick state_changed payload onto state_trk', () => {
    const event = {
      ...callEvent('1'),
      eventType: EventTypes.AGENT_STATE_CHANGED,
      payload: { id: 88, agentId: 1, status: 32, beginTime: '2026-08-26T03:00:00Z' },
    };
    const [row] = transformEvent(event, 'state_trk_to_icc', defaultHubConfig.transforms);
    expect(row.__hub_table).toBe('t_icc_ag_state_trk_record');
    expect(row.id).toBe(88);
    expect(row.agentid).toBe(1);
    const picked = pickMirrorRow(String(row.__hub_table), row);
    expect(picked.row.id).toBe('88');
  });

  it('registers fact-table routes for remaining mirrors', () => {
    const names = defaultHubConfig.routes.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      'agent-state-to-icc-pg',
      'agent-login-to-icc-pg',
      'cdr-to-icc-pg',
      'acd-route-to-icc-pg',
      'ivr-route-to-icc-pg',
      'ivr-trace-to-icc-pg',
    ]));
  });
});
