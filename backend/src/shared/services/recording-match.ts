export interface CdrMatchKey {
  caller: string;
  called: string;
  beginSec: number;
  endSec?: number | null;
  talkSec?: number;
  logicNo?: number | null;
}

export interface DbRecordFile {
  caller: string;
  called: string;
  beginSec: number;
  recordFile: string;
}

export interface FsRecordFile {
  relPath: string;
  unixSec: number;
  recCh?: number;
}

export function normalizePhone(s: string): string {
  return String(s || '').replace(/\D/g, '');
}

export function phonesOverlap(
  aCaller: string,
  aCalled: string,
  bCaller: string,
  bCalled: string,
): boolean {
  const a = new Set([normalizePhone(aCaller), normalizePhone(aCalled)].filter(Boolean));
  const b = new Set([normalizePhone(bCaller), normalizePhone(bCalled)].filter(Boolean));
  for (const n of a) {
    if (b.has(n)) return true;
  }
  return false;
}

const AG_NAME = /^ag_(\d+)_(\d+)_(\d+)\.wav$/i;

export function parseAgRecordingName(name: string): {
  agentId: number;
  recCh: number;
  unixSec: number;
} | null {
  const base = String(name || '').replace(/\\/g, '/').split('/').pop() || '';
  const m = base.match(AG_NAME);
  if (!m) return null;
  return {
    agentId: Number(m[1]),
    recCh: Number(m[2]),
    unixSec: Number(m[3]),
  };
}

/** 先对齐库里的 RecordFile，没有再按录音文件名里的 unix 时间窗匹配。 */
export function matchRecordFile(
  cdr: CdrMatchKey,
  dbFiles: DbRecordFile[],
  fsFiles: FsRecordFile[] = [],
): string | null {
  const begin = Number(cdr.beginSec);
  if (!Number.isFinite(begin) || begin <= 0) return null;

  let bestDb: { path: string; delta: number } | null = null;
  for (const f of dbFiles) {
    if (!f.recordFile) continue;
    if (!phonesOverlap(cdr.caller, cdr.called, f.caller, f.called)) continue;
    const delta = Math.abs(Number(f.beginSec) - begin);
    if (delta > 8) continue;
    if (!bestDb || delta < bestDb.delta) bestDb = { path: f.recordFile, delta };
  }
  if (bestDb) return bestDb.path;

  const talk = Number.isFinite(cdr.talkSec) ? Math.max(0, Number(cdr.talkSec)) : 0;
  const end = Number.isFinite(cdr.endSec as number) && Number(cdr.endSec) > 0
    ? Number(cdr.endSec)
    : begin + talk;
  const lo = begin - 10;
  const hi = Math.max(end, begin) + 60;

  let bestFs: { path: string; score: number } | null = null;
  for (const f of fsFiles) {
    if (f.unixSec < lo || f.unixSec > hi) continue;
    const delta = Math.abs(f.unixSec - begin);
    const preferCh = cdr.logicNo && f.recCh === cdr.logicNo ? -0.4 : 0;
    const score = delta + preferCh;
    if (!bestFs || score < bestFs.score) bestFs = { path: f.relPath, score };
  }
  return bestFs?.path ?? null;
}
