#!/usr/bin/env node
/** 把 icc 运营表镜像到 PG schema icc（历史回填，幂等 upsert）。 */
const mysql = require('mysql2/promise');
const { PrismaClient } = require('@prisma/client');

const CALL_COLS = [
  'pid', 'parentpid', 'vdnid', 'vdnname', 'mediaid', 'mediatype', 'logicno',
  'channelgroupid', 'channelgroupname', 'spanid', 'channelno', 'callingno', 'calledno',
  'begintime', 'answertime', 'endtime', 'calldirection', 'calltype', 'devicetypeid',
  'releasecause', 'answertimelong', 'talktimelong',
];
const AG_COLS = [
  'pid', 'acdroutepid', 'basecallpid', 'parentcallpid', 'vdnid', 'vdnname', 'mediaid',
  'mediatype', 'callingno', 'calledno', 'agentgroupid', 'agentgroupname', 'skillid',
  'skillname', 'createcalltime', 'enterivrtime', 'enteracdtime', 'begintime', 'ringtime',
  'answertime', 'aftertime', 'endtime', 'agentid', 'workno', 'agentname', 'releasecause',
  'satisficing', 'recordfile', 'calldirection', 'calltype', 'ringtimelong', 'talktimelong',
  'aftertimelong', 'label', 'chmediatype',
];
const ACD_COLS = [
  'pid', 'basecallpid', 'vdnid', 'vdnname', 'mediaid', 'mediatype', 'callingno', 'calledno',
  'agentgroupid', 'agentgroupname', 'skillid', 'skillname', 'workno', 'queuelenenter',
  'queuelenleft', 'ewt', 'begintime', 'endtime', 'leftcauseid', 'leftcausecnname',
  'leftcauseenname', 'queuetimelong', 'requestno', 'processstatus', 'processcontent',
  'processagentid', 'processworkno', 'processagentname', 'processdate',
];
const STATE_COLS = [
  'id', 'agentid', 'workno', 'consn', 'callsn', 'accessmediatype', 'status', 'statusname',
  'begintime', 'endtime', 'statetime', 'operatetype', 'operatename', 'operateworkno',
  'operatefailcause', 'logoutreasoncode', 'auxcode', 'vdnname', 'vdnid', 'agentname',
  'logintime', 'logintimelen', 'agroutelogpid', 'basecallpid', 'parentcallpid',
];
const LOGIN_COLS = [
  'pid', 'vdnname', 'vdnid', 'agentname', 'workno', 'agentid', 'logintime', 'logouttime', 'extension',
];
const CDR_COLS = [
  'id', 'consn', 'callsn', 'span', 'channel', 'trunkgroup', 'caller', 'called',
  'initializetime', 'answertime', 'connecttime', 'releasetime',
  'initializetimems', 'answertimems', 'connecttimems', 'releasetimems',
  'talkduration', 'answerduration', 'cause', 'callflag', 'pid',
];
const IVR_ROUTE_COLS = [
  'pid', 'basecallpid', 'vdnid', 'vdnname', 'ivrappid', 'flowid', 'flowname',
  'begintime', 'answertime', 'endtime', 'callingno', 'calledno', 'logicno',
  'answertimelong', 'talktimelong', 'flowtype',
  'leftcauseid', 'leftcausecnname', 'leftcauseenname',
];
const IVR_TRACE_COLS = [
  'pid', 'ivrroutepid', 'begintime', 'endtime', 'flowid', 'nodeid', 'nodetype',
  'nodename', 'nodedeep', 'nodevalue', 'nodetimelong', 'noderesult',
];
const CHANNELGROUP_COLS = [
  'id', 'name', 'beginspanid', 'beginchannelid', 'endspanid', 'endchannelid',
  'seektype', 'vdnid', 'callercapacity',
];
const FAX_RECV_COLS = [
  'id', 'vdnid', 'workno', 'filename', 'time', 'readflag', 'pagenum',
  'callingno', 'checked', 'calledno', 'faxresult', 'ifread', 'processdate',
  'agentname', 'recid', 'processresult',
];
const FAX_SND_COLS = [
  'id', 'faxspec', 'faxno', 'startdate1', 'enddate1', 'startdate2', 'enddate2',
  'priority', 'uploadfaxfile', 'uploadfaxfilealias', 'uploadfaxfileconv',
  'sndstate', 'ifconv', 'convdate', 'snddate', 'sndresult', 'maxsndcnt',
  'sndedcnt', 'sndinterval', 'agentid', 'workno', 'agentname', 'insertdate',
  'ftpokafterconv', 'sessionid', 'sndok', 'checked', 'vdnid',
];
const TIME_COLS = new Set([
  'begintime', 'answertime', 'endtime', 'createcalltime', 'enterivrtime', 'enteracdtime',
  'ringtime', 'aftertime', 'logintime', 'processdate', 'logouttime',
  'initializetime', 'connecttime', 'releasetime',
  'time', 'snddate', 'insertdate', 'convdate', 'startdate1', 'enddate1', 'startdate2', 'enddate2',
]);

function norm(col, v) {
  if (v === undefined || v === null) return null;
  if (TIME_COLS.has(col)) {
    const s = v instanceof Date ? v.toISOString() : String(v).trim();
    if (!s || s.startsWith('0000')) return null;
    const d = v instanceof Date ? v : new Date(s.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return v;
}

function rowOf(raw, cols) {
  const lower = {};
  for (const [k, v] of Object.entries(raw)) lower[k.toLowerCase()] = v;
  const out = {};
  for (const c of cols) out[c] = norm(c, lower[c]);
  return out;
}

const CAST = {
  pid: 'bigint', parentpid: 'bigint', acdroutepid: 'bigint', basecallpid: 'bigint', parentcallpid: 'bigint',
  id: 'bigint', consn: 'bigint', callsn: 'bigint', agroutelogpid: 'bigint',
  vdnid: 'integer', mediaid: 'integer', logicno: 'integer', channelgroupid: 'integer', spanid: 'integer',
  channelno: 'integer', calldirection: 'smallint', calltype: 'smallint', devicetypeid: 'integer',
  releasecause: 'integer', answertimelong: 'integer', talktimelong: 'integer', ringtimelong: 'integer',
  aftertimelong: 'integer', agentgroupid: 'integer', skillid: 'integer', agentid: 'integer',
  satisficing: 'integer', label: 'integer', chmediatype: 'integer',
  queuelenenter: 'integer', queuelenleft: 'integer', ewt: 'integer', leftcauseid: 'integer',
  queuetimelong: 'integer', requestno: 'integer', processstatus: 'integer', processagentid: 'integer',
  status: 'integer', statetime: 'integer', operatetype: 'integer', operatefailcause: 'integer',
  auxcode: 'integer', logintimelen: 'integer',
  ivrroutepid: 'bigint', ivrappid: 'integer', flowid: 'integer', flowtype: 'integer',
  nodeid: 'integer', nodetype: 'smallint', nodedeep: 'smallint', nodetimelong: 'integer', noderesult: 'integer',
  span: 'integer', channel: 'integer', cause: 'integer',
  initializetimems: 'integer', answertimems: 'integer', connecttimems: 'integer', releasetimems: 'integer',
  talkduration: 'double precision', answerduration: 'double precision',
  begintime: 'timestamptz', answertime: 'timestamptz', endtime: 'timestamptz', createcalltime: 'timestamptz',
  enterivrtime: 'timestamptz', enteracdtime: 'timestamptz', ringtime: 'timestamptz', aftertime: 'timestamptz',
  logintime: 'timestamptz', processdate: 'timestamptz', logouttime: 'timestamptz',
  initializetime: 'timestamptz', connecttime: 'timestamptz', releasetime: 'timestamptz',
};

function phCast(idx, col) {
  const t = CAST[col];
  return t ? `$${idx}::${t}` : `$${idx}`;
}

async function upsert(prisma, table, cols, rows, conflictKey = 'pid') {
  if (!rows.length) return 0;
  const colSql = cols.map((c) => `"${c}"`).join(', ');
  const nonKey = cols.filter((c) => c !== conflictKey);
  const upd = nonKey.length
    ? nonKey.map((c) => `"${c}" = EXCLUDED."${c}"`).join(', ')
    : `"${conflictKey}" = EXCLUDED."${conflictKey}"`;
  let n = 0;
  const batch = 40;
  for (let i = 0; i < rows.length; i += batch) {
    const slice = rows.slice(i, i + batch);
    const params = [];
    const values = slice.map((row, ri) => {
      const ph = cols.map((c, ci) => phCast(ri * cols.length + ci + 1, c));
      for (const c of cols) params.push(row[c]);
      return `(${ph.join(', ')})`;
    });
    await prisma.$executeRawUnsafe(
      `INSERT INTO icc."${table}" (${colSql}) VALUES ${values.join(', ')}
       ON CONFLICT ("${conflictKey}") DO UPDATE SET ${upd}`,
      ...params,
    );
    n += slice.length;
  }
  return n;
}

async function main() {
  const mysqlConn = await mysql.createConnection({
    host: process.env.ICC_MYSQL_HOST || '172.22.0.3',
    port: Number(process.env.ICC_MYSQL_PORT || 3306),
    user: process.env.ICC_MYSQL_USER || 'root',
    password: process.env.ICC_MYSQL_PASSWORD || 'ChangeMe123!',
    database: process.env.ICC_MYSQL_DB || 'icc',
    charset: 'utf8mb4',
    supportBigNumbers: true,
    bigNumberStrings: true,
    dateStrings: true,
  });
  const prisma = new PrismaClient();
  try {
    const [calls] = await mysqlConn.query('SELECT * FROM t_icc_base_call_log');
    const [ags] = await mysqlConn.query('SELECT * FROM t_icc_ag_route_log');
    const [acds] = await mysqlConn.query('SELECT * FROM t_icc_acd_route_log');
    const [states] = await mysqlConn.query('SELECT * FROM t_icc_ag_state_trk_record');
    const [logins] = await mysqlConn.query('SELECT * FROM t_icc_ag_login_log');
    const [cdrs] = await mysqlConn.query('SELECT * FROM t_icc_base_cdr');
    const [ivrs] = await mysqlConn.query('SELECT * FROM t_icc_ivr_route_log');
    const [traces] = await mysqlConn.query('SELECT * FROM t_icc_ivr_trace_log');
    let groups = [];
    let faxIn = [];
    let faxOut = [];
    try { [groups] = await mysqlConn.query('SELECT * FROM t_icc_base_channelgroup'); } catch { /* 无表 */ }
    try { [faxIn] = await mysqlConn.query('SELECT * FROM t_icc_faxs_recv'); } catch { /* 无表 */ }
    try { [faxOut] = await mysqlConn.query('SELECT * FROM t_icc_faxs_sndfax1001d'); } catch { /* 无表 */ }
    const nc = await upsert(prisma, 't_icc_base_call_log', CALL_COLS, calls.map((r) => rowOf(r, CALL_COLS)));
    const na = await upsert(prisma, 't_icc_ag_route_log', AG_COLS, ags.map((r) => rowOf(r, AG_COLS)));
    const nd = await upsert(prisma, 't_icc_acd_route_log', ACD_COLS, acds.map((r) => rowOf(r, ACD_COLS)));
    const ns = await upsert(prisma, 't_icc_ag_state_trk_record', STATE_COLS, states.map((r) => rowOf(r, STATE_COLS)), 'id');
    const nl = await upsert(prisma, 't_icc_ag_login_log', LOGIN_COLS, logins.map((r) => rowOf(r, LOGIN_COLS)));
    const ncdr = await upsert(prisma, 't_icc_base_cdr', CDR_COLS, cdrs.map((r) => rowOf(r, CDR_COLS)), 'id');
    const ni = await upsert(prisma, 't_icc_ivr_route_log', IVR_ROUTE_COLS, ivrs.map((r) => rowOf(r, IVR_ROUTE_COLS)));
    const nt = await upsert(prisma, 't_icc_ivr_trace_log', IVR_TRACE_COLS, traces.map((r) => rowOf(r, IVR_TRACE_COLS)));
    const ng = await upsert(prisma, 't_icc_base_channelgroup', CHANNELGROUP_COLS, groups.map((r) => rowOf(r, CHANNELGROUP_COLS)), 'id');
    const nfi = await upsert(prisma, 't_icc_faxs_recv', FAX_RECV_COLS, faxIn.map((r) => rowOf(r, FAX_RECV_COLS)), 'id');
    const nfo = await upsert(prisma, 't_icc_faxs_sndfax1001d', FAX_SND_COLS, faxOut.map((r) => rowOf(r, FAX_SND_COLS)), 'id');
    console.log(JSON.stringify({
      call_log: nc, ag_route: na, acd_route: nd, state_trk: ns,
      login: nl, cdr: ncdr, ivr_route: ni, ivr_trace: nt,
      channelgroup: ng, fax_recv: nfi, fax_snd: nfo,
    }));
  } finally {
    await mysqlConn.end();
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
