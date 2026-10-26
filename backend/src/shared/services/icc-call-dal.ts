import { getIccReadPool as getIccMysqlPool } from './icc-tenant-read.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import type { DbRecordFile } from './recording-match.js';

let recordIndexMissing = false;

function isMissingTable(e: unknown): boolean {
  const code = e && typeof e === 'object' && 'code' in e ? String((e as { code?: string }).code) : '';
  const msg = e instanceof Error ? e.message : String(e ?? '');
  return code === 'ER_NO_SUCH_TABLE' || /doesn't exist|does not exist/i.test(msg);
}

export async function lookupRecordPath(callId: number): Promise<string | null> {
  if (!callId) return null;
  const p = await getIccMysqlPool();
  if (!p) return null;
  if (!confTenancyEnabled() && !recordIndexMissing) {
    try {
      const [rows] = await p.query(
        'SELECT file_path FROM t_record_index WHERE ag_call_pid = ? LIMIT 1',
        [callId],
      );
      const path = (rows as Array<{ file_path?: string }>)[0]?.file_path;
      if (path) return String(path);
    } catch (e) {
      if (isMissingTable(e)) {
        recordIndexMissing = true;
      } else {
        console.error('[icc-call] lookup t_record_index failed', e);
      }
    }
  }
  try {
    const [rows] = await p.query(
      'SELECT RecordFile FROM t_icc_ag_route_log WHERE PID = ? AND RecordFile IS NOT NULL AND RecordFile <> \'\' LIMIT 1',
      [callId],
    );
    const path = (rows as Array<{ RecordFile?: string }>)[0]?.RecordFile;
    if (path) return String(path);
  } catch (e) {
    console.error('[icc-call] lookup t_icc_ag_route_log failed', e);
  }
  try {
    const [rows] = await p.query(
      `SELECT r.RecordFile AS recordFile
       FROM t_icc_base_call_log c
       INNER JOIN t_icc_ag_call_record r
         ON (r.Caller = c.CallingNO OR r.Called = c.CalledNO)
        AND ABS(TIMESTAMPDIFF(SECOND, r.BeginTime, c.BeginTime)) <= 8
       WHERE c.LogicNO = ?
         AND r.RecordFile IS NOT NULL AND r.RecordFile <> ''
       ORDER BY c.EndTime DESC
       LIMIT 1`,
      [callId],
    );
    const path = (rows as Array<{ recordFile?: string }>)[0]?.recordFile;
    if (path) return String(path);
  } catch (e) {
    console.error('[icc-call] lookup t_icc_ag_call_record by LogicNO failed', e);
  }
  return null;
}

export async function lookupRecordFilesByNumber(phone: string, limit = 80): Promise<DbRecordFile[]> {
  const no = phone.trim();
  if (!no) return [];
  const p = await getIccMysqlPool();
  if (!p) return [];
  const take = Math.min(80, Math.max(1, Math.floor(limit)));
  const out: DbRecordFile[] = [];
  const pushRows = (rows: Array<Record<string, unknown>>) => {
    for (const r of rows) {
      const recordFile = r.recordFile != null ? String(r.recordFile).trim() : '';
      if (!recordFile) continue;
      const begin = toDate(r.beginTime);
      if (!begin) continue;
      out.push({
        caller: r.caller != null ? String(r.caller) : '',
        called: r.called != null ? String(r.called) : '',
        beginSec: Math.floor(begin.getTime() / 1000),
        recordFile,
      });
    }
  };
  try {
    const [rows] = await p.query(
      `SELECT Caller AS caller, Called AS called, BeginTime AS beginTime, RecordFile AS recordFile
       FROM t_icc_ag_call_record
       WHERE (Caller = ? OR Called = ?)
         AND RecordFile IS NOT NULL AND RecordFile <> ''
       ORDER BY BeginTime DESC
       LIMIT ${take}`,
      [no, no],
    );
    pushRows(rows as Array<Record<string, unknown>>);
  } catch (e) {
    console.error('[icc-call] lookup t_icc_ag_call_record files failed', e);
  }
  try {
    const [rows] = await p.query(
      `SELECT CallingNO AS caller, CalledNO AS called, BeginTime AS beginTime, RecordFile AS recordFile
       FROM t_icc_ag_route_log
       WHERE (CallingNO = ? OR CalledNO = ?)
         AND RecordFile IS NOT NULL AND RecordFile <> ''
       ORDER BY BeginTime DESC
       LIMIT ${take}`,
      [no, no],
    );
    pushRows(rows as Array<Record<string, unknown>>);
  } catch (e) {
    console.error('[icc-call] lookup t_icc_ag_route_log files failed', e);
  }
  return out;
}

export interface IccCdrRow {
  callId: number | null;
  /** 展示用主叫：来电=客户号码；转席=发起转的坐席工号 */
  caller: string;
  /** 原始 CallingNO（录音匹配用） */
  callingNo: string;
  called: string;
  beginTime: Date | null;
  answerTime: Date | null;
  endTime: Date | null;
  talkTimeLong: number;
  direction: number;
  callType: number;
  /** 方式：来电 / 保持转席 / 释放转席 / 咨询转席 / 释放转IVR / 保持转IVR / 咨询转外 / … */
  method: string;
  workNo: string;
  releaseCause: number;
  hangupReason: string;
}

/** 对齐 Focus EU_AG_REL_CAUSE / AgReleaseCause2CnStr */
export function resolveHangupReason(releaseCause: number): string {
  switch (releaseCause) {
    case 1: return '等待坐席应答超时';
    case 2: return '被另一坐席抢接';
    case 3: return '被另一坐席拦截';
    case 4: return '被另一坐席注销';
    case 5: return '坐席注销';
    case 6: return '坐席挂断';
    case 7: return '对方挂断';
    case 8: return '呼叫被转移';
    case 9: return '等待对方应答超时';
    case 10: return '呼出不成功';
    case 11: return '呼叫被保持';
    case 12: return '呼坐席分机失败';
    case 13: return '创建会议失败';
    case 14: return '坐席分机入会失败';
    case 15: return '外线入会失败';
    case 16: return '通话被强拆';
    case 17: return '坐席挂断(分机)';
    case 18: return '等待外线应答超时';
    case 19: return '找回保持呼叫';
    case 31: return '系统释放';
    default: return releaseCause > 0 ? `原因${releaseCause}` : '—';
  }
}

export interface AgentDailyTraffic {
  answered: number;
  missed: number;
}

/** 当日坐席话务：已接=有应答；未接=已结束且无应答 */
export async function lookupAgentDailyTraffic(workNo: string): Promise<AgentDailyTraffic> {
  const no = workNo.trim();
  if (!no) return { answered: 0, missed: 0 };
  const p = await getIccMysqlPool();
  if (!p) return { answered: 0, missed: 0 };
  try {
    const [rows] = await p.query(
      `SELECT
         SUM(CASE WHEN AnswerTime IS NOT NULL THEN 1 ELSE 0 END) AS answered,
         SUM(CASE WHEN AnswerTime IS NULL AND EndTime IS NOT NULL THEN 1 ELSE 0 END) AS missed
       FROM t_icc_ag_route_log
       WHERE WorkNO = ?
         AND BeginTime >= CURDATE()
         AND BeginTime < DATE_ADD(CURDATE(), INTERVAL 1 DAY)`,
      [no],
    );
    const row = (rows as Array<{ answered?: number; missed?: number }>)[0];
    return {
      answered: row?.answered != null ? Number(row.answered) : 0,
      missed: row?.missed != null ? Number(row.missed) : 0,
    };
  } catch (e) {
    console.error('[icc-call] lookupAgentDailyTraffic failed', e);
    return { answered: 0, missed: 0 };
  }
}

function toDate(v: unknown): Date | null {
  if (v instanceof Date && Number.isFinite(v.getTime())) return v;
  if (typeof v === 'string' && v.trim()) {
    const d = new Date(v);
    return Number.isFinite(d.getTime()) ? d : null;
  }
  return null;
}

/**
 * 对齐 ICIP CallType + Omni 转移菜单（CCS 补齐后可直读）：
 * - 来电：CT=1/2/3/18
 * - 释放转席：CT=9 / 源腿 label=4（AutoRetrieve=2）
 * - 保持转席：CT=10 / 源腿 label=6（AutoRetrieve=1）
 * - 咨询转席：CT=26 / 源腿 label=7（AutoRetrieve=0）
 * - 转组：CT=24/25（Focus）
 * - 释放转IVR：label=1；保持转IVR：label=5
 * - IVR 再转来：CT=19 释放 / CT=20 保持
 * - 释放/保持/咨询转外：label=3 + 子 base CT=2/3/13
 */
export function resolveCallMethod(opts: {
  direction: number;
  callType: number;
  releaseCause: number;
  parentCallPid: number;
  acdRoutePid: number;
  xferOutBaseType: number;
  hasIvrAfter: boolean;
  label?: number;
}): string {
  const {
    direction, callType, releaseCause, parentCallPid, acdRoutePid,
    xferOutBaseType, hasIvrAfter, label = 0,
  } = opts;

  // 目标腿：按 CallType 直读
  if (direction === 1) {
    if (callType === 26) return '咨询转席';
    if (callType === 10) return '保持转席';
    if (callType === 9) return '释放转席';
    if (callType === 24 || callType === 25) return '转组';
    if (callType === 19) return 'IVR释放转来';
    if (callType === 20) return 'IVR保持转来';
  }

  // 源腿被转走：label 优先（不覆盖原来电 CallType）
  if (releaseCause === 8 || label > 0) {
    if (label === 1) return '释放转IVR';
    if (label === 5) return '保持转IVR';
    if (label === 2) return '转组';
    if (label === 3) {
      if (xferOutBaseType === 13) return '咨询转外';
      if (xferOutBaseType === 3) return '保持转外';
      return '释放转外';
    }
    if (label === 4) return '释放转席';
    if (label === 6) return '保持转席';
    if (label === 7) return '咨询转席';
    // 兼容旧数据（无细分 label）
    if (hasIvrAfter) return '释放转IVR';
    if (xferOutBaseType === 13) return '咨询转外';
    if (xferOutBaseType === 3) return '保持转外';
    if (xferOutBaseType === 2) return '释放转外';
    if (parentCallPid > 0 && acdRoutePid > 0) return '转组';
  }

  if (direction === 1) {
    if ([1, 2, 3, 18, 8].includes(callType)) return '来电';
    return '来电';
  }

  if (direction === 2) {
    if (callType === 2) return '释放转外';
    if (callType === 3) return '保持转外';
    if (callType === 13) return '咨询转外';
    if (callType === 4) return '外呼';
    if (callType === 7) return '坐席呼坐席';
  }

  return '来电';
}

function resolveDisplayCaller(opts: {
  callingNo: string;
  callType: number;
  parentWorkNo: string;
  method: string;
}): string {
  const { callingNo, callType, parentWorkNo, method } = opts;
  // 转席类：主叫显示发起转的坐席工号
  const transferIn = ['释放转席', '保持转席', '咨询转席', '转组'].includes(method)
    || [8, 9, 10, 24, 25, 26].includes(callType);
  if (transferIn && parentWorkNo) return parentWorkNo;
  return callingNo;
}

export async function lookupCallCdrsByNumber(phone: string, limit = 50): Promise<IccCdrRow[]> {
  const no = phone.trim();
  if (!no) return [];
  const p = await getIccMysqlPool();
  if (!p) return [];
  const take = Math.min(80, Math.max(1, Math.floor(limit)));
  try {
    // 优先坐席路由明细（含 CallType / 转接父段）；无则回退 base_call_log
    const [rows] = await p.query(
      `SELECT A.PID AS callId,
              A.CallingNO AS callingNo,
              A.CalledNO AS called,
              A.BeginTime AS beginTime,
              A.AnswerTime AS answerTime,
              A.EndTime AS endTime,
              A.TalkTimeLong AS talkTimeLong,
              A.CallDirection AS direction,
              A.CallType AS callType,
              IFNULL(A.ReleaseCause, 0) AS releaseCause,
              IFNULL(A.ParentCallPID, 0) AS parentCallPid,
              IFNULL(A.ACDRoutePID, 0) AS acdRoutePid,
              IFNULL(A.label, 0) AS label,
              IFNULL(A.WorkNO, '') AS workNo,
              IFNULL(P.WorkNO, '') AS parentWorkNo,
              IFNULL((
                SELECT B.CallType FROM t_icc_base_call_log B
                 WHERE A.BaseCallPID IS NOT NULL
                   AND B.ParentPID = A.BaseCallPID
                   AND B.CallDirection = 2
                   AND B.CallType IN (2, 3, 13)
                 ORDER BY B.BeginTime ASC
                 LIMIT 1
              ), 0) AS xferOutBaseType,
              IFNULL((
                SELECT 1 FROM t_icc_ivr_route_log I
                 WHERE I.CallingNO = A.CallingNO
                   AND I.BeginTime >= A.BeginTime
                   AND (A.EndTime IS NULL OR I.BeginTime <= DATE_ADD(A.EndTime, INTERVAL 30 SECOND))
                 LIMIT 1
              ), 0) AS hasIvrAfter
         FROM t_icc_ag_route_log A
         LEFT JOIN t_icc_ag_route_log P ON P.PID = A.ParentCallPID
        WHERE A.CallingNO = ? OR A.CalledNO = ?
        ORDER BY A.BeginTime DESC
        LIMIT ${take}`,
      [no, no],
    );
    const list = (rows as Array<Record<string, unknown>>).map((r) => {
      const callingNo = r.callingNo != null ? String(r.callingNo) : '';
      const callType = r.callType != null ? Number(r.callType) : 0;
      const direction = r.direction != null ? Number(r.direction) : 0;
      const releaseCause = r.releaseCause != null ? Number(r.releaseCause) : 0;
      const parentCallPid = r.parentCallPid != null ? Number(r.parentCallPid) : 0;
      const acdRoutePid = r.acdRoutePid != null ? Number(r.acdRoutePid) : 0;
      const label = r.label != null ? Number(r.label) : 0;
      const xferOutBaseType = r.xferOutBaseType != null ? Number(r.xferOutBaseType) : 0;
      const hasIvrAfter = Number(r.hasIvrAfter) === 1;
      const parentWorkNo = r.parentWorkNo != null ? String(r.parentWorkNo) : '';
      const method = resolveCallMethod({
        direction,
        callType,
        releaseCause,
        parentCallPid,
        acdRoutePid,
        xferOutBaseType,
        hasIvrAfter,
        label,
      });
      const caller = resolveDisplayCaller({ callingNo, callType, parentWorkNo, method });
      return {
        callId: r.callId != null && Number.isFinite(Number(r.callId)) ? Number(r.callId) : null,
        caller,
        callingNo,
        called: r.called != null ? String(r.called) : '',
        beginTime: toDate(r.beginTime),
        answerTime: toDate(r.answerTime),
        endTime: toDate(r.endTime),
        talkTimeLong: r.talkTimeLong != null ? Number(r.talkTimeLong) : 0,
        direction,
        callType,
        method,
        workNo: r.workNo != null ? String(r.workNo) : '',
        releaseCause,
        hangupReason: resolveHangupReason(releaseCause),
      };
    });
    if (list.length) return list;
  } catch (e) {
    console.error('[icc-call] lookup ag_route_log by number failed', e);
  }
  try {
    const [rows] = await p.query(
      `SELECT LogicNO AS callId, CallingNO AS callingNo, CalledNO AS called,
              BeginTime AS beginTime, AnswerTime AS answerTime, EndTime AS endTime,
              TalkTimeLong AS talkTimeLong, CallDirection AS direction, CallType AS callType,
              IFNULL(ReleaseCause, 0) AS releaseCause
       FROM t_icc_base_call_log
       WHERE CallingNO = ? OR CalledNO = ?
       ORDER BY BeginTime DESC
       LIMIT ${take}`,
      [no, no],
    );
    return (rows as Array<Record<string, unknown>>).map((r) => {
      const callingNo = r.callingNo != null ? String(r.callingNo) : '';
      const callType = r.callType != null ? Number(r.callType) : 0;
      const direction = r.direction != null ? Number(r.direction) : 0;
      const releaseCause = r.releaseCause != null ? Number(r.releaseCause) : 0;
      const method = resolveCallMethod({
        direction,
        callType,
        releaseCause,
        parentCallPid: 0,
        acdRoutePid: 0,
        xferOutBaseType: direction === 2 ? callType : 0,
        hasIvrAfter: false,
      });
      return {
        callId: r.callId != null && Number.isFinite(Number(r.callId)) ? Number(r.callId) : null,
        caller: callingNo,
        callingNo,
        called: r.called != null ? String(r.called) : '',
        beginTime: toDate(r.beginTime),
        answerTime: toDate(r.answerTime),
        endTime: toDate(r.endTime),
        talkTimeLong: r.talkTimeLong != null ? Number(r.talkTimeLong) : 0,
        direction,
        callType,
        method,
        workNo: '',
        releaseCause,
        hangupReason: resolveHangupReason(releaseCause),
      };
    });
  } catch (e) {
    console.error('[icc-call] lookup call log by number failed', e);
    return [];
  }
}

export async function lookupCallCdr(logicNo: number): Promise<{
  talkTimeLong?: number;
  callerNo?: string;
  calledNo?: string;
  beginTime?: Date | null;
  endTime?: Date | null;
} | null> {
  if (!logicNo) return null;
  const p = await getIccMysqlPool();
  if (!p) return null;
  try {
    const [rows] = await p.query(
      `SELECT TalkTimeLong AS talkTimeLong, CallingNO AS callerNo, CalledNO AS calledNo,
              BeginTime AS beginTime, EndTime AS endTime
       FROM t_icc_base_call_log
       WHERE LogicNO = ?
       ORDER BY EndTime DESC
       LIMIT 1`,
      [logicNo],
    );
    const row = (rows as Array<Record<string, unknown>>)[0];
    if (!row) return null;
    return {
      talkTimeLong: row.talkTimeLong != null ? Number(row.talkTimeLong) : undefined,
      callerNo: row.callerNo != null ? String(row.callerNo) : undefined,
      calledNo: row.calledNo != null ? String(row.calledNo) : undefined,
      beginTime: toDate(row.beginTime),
      endTime: toDate(row.endTime),
    };
  } catch (e) {
    console.error('[icc-call] lookup t_icc_base_call_log failed', e);
    return null;
  }
}
