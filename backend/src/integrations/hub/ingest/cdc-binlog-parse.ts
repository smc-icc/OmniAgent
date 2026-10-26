/**
 * MySQL ROW binlog 事件解析（不依赖第三方 connector）。
 * 覆盖 FORMAT_DESC / ROTATE / GTID / TABLE_MAP / WRITE|UPDATE|DELETE_ROWS v1/v2。
 */
import type { CdcChange, CdcCursor, CdcOp } from './cdc-map.js';

export const COM_BINLOG_DUMP = 0x12;

export const EventType = {
  QUERY: 2,
  ROTATE: 4,
  FORMAT_DESCRIPTION: 15,
  XID: 16,
  TABLE_MAP: 19,
  WRITE_ROWS_V1: 23,
  UPDATE_ROWS_V1: 24,
  DELETE_ROWS_V1: 25,
  HEARTBEAT: 27,
  WRITE_ROWS: 30,
  UPDATE_ROWS: 31,
  DELETE_ROWS: 32,
  GTID: 33,
  ANONYMOUS_GTID: 34,
} as const;

export const MysqlType = {
  DECIMAL: 0,
  TINY: 1,
  SHORT: 2,
  LONG: 3,
  FLOAT: 4,
  DOUBLE: 5,
  NULL: 6,
  TIMESTAMP: 7,
  LONGLONG: 8,
  INT24: 9,
  DATE: 10,
  TIME: 11,
  DATETIME: 12,
  YEAR: 13,
  VARCHAR: 15,
  BIT: 16,
  TIMESTAMP2: 17,
  DATETIME2: 18,
  TIME2: 19,
  JSON: 245,
  NEWDECIMAL: 246,
  ENUM: 247,
  SET: 248,
  TINY_BLOB: 249,
  MEDIUM_BLOB: 250,
  LONG_BLOB: 251,
  BLOB: 252,
  VAR_STRING: 253,
  STRING: 254,
  GEOMETRY: 255,
} as const;

export interface BinlogEventHeader {
  timestamp: number;
  type: number;
  serverId: number;
  size: number;
  nextPos: number;
  flags: number;
}

export interface TableMap {
  tableId: bigint;
  schema: string;
  table: string;
  types: number[];
  metadata: Buffer;
  columnNames?: string[];
}

export interface ParsedBinlogEvent {
  header: BinlogEventHeader;
  type: number;
  payload: Buffer;
  rotate?: { file: string; pos: number };
  gtid?: string;
  tableMap?: TableMap;
  rows?: {
    tableId: bigint;
    op: CdcOp;
    rows: Array<{ before?: unknown[]; after?: unknown[] }>;
  };
}

export function readLenenc(buf: Buffer, offset: number): { value: number; next: number } {
  if (offset >= buf.length) return { value: 0, next: offset };
  const first = buf[offset]!;
  if (first < 0xfb) return { value: first, next: offset + 1 };
  if (first === 0xfc) return { value: buf.readUInt16LE(offset + 1), next: offset + 3 };
  if (first === 0xfd) return { value: buf.readUIntLE(offset + 1, 3), next: offset + 4 };
  if (first === 0xfe) return { value: Number(buf.readBigUInt64LE(offset + 1)), next: offset + 9 };
  return { value: 0, next: offset + 1 };
}

export function writeLenenc(n: number): Buffer {
  if (n < 251) return Buffer.from([n]);
  if (n < 65536) {
    const b = Buffer.alloc(3);
    b[0] = 0xfc;
    b.writeUInt16LE(n, 1);
    return b;
  }
  const b = Buffer.alloc(4);
  b[0] = 0xfd;
  b.writeUIntLE(n, 1, 3);
  return b;
}

export function parseEventHeader(buf: Buffer): BinlogEventHeader {
  return {
    timestamp: buf.readUInt32LE(0),
    type: buf[4]!,
    serverId: buf.readUInt32LE(5),
    size: buf.readUInt32LE(9),
    nextPos: buf.readUInt32LE(13),
    flags: buf.readUInt16LE(17),
  };
}

export function encodeEvent(type: number, body: Buffer, opts?: {
  timestamp?: number;
  serverId?: number;
  nextPos?: number;
  flags?: number;
}): Buffer {
  const header = Buffer.alloc(19);
  header.writeUInt32LE(opts?.timestamp ?? 0, 0);
  header[4] = type;
  header.writeUInt32LE(opts?.serverId ?? 1, 5);
  header.writeUInt32LE(19 + body.length, 9);
  header.writeUInt32LE(opts?.nextPos ?? 19 + body.length, 13);
  header.writeUInt16LE(opts?.flags ?? 0, 17);
  return Buffer.concat([header, body]);
}

export function wrapMysqlPacket(payload: Buffer, seq = 0): Buffer {
  const header = Buffer.alloc(4);
  header[0] = payload.length & 0xff;
  header[1] = (payload.length >> 8) & 0xff;
  header[2] = (payload.length >> 16) & 0xff;
  header[3] = seq & 0xff;
  return Buffer.concat([header, payload]);
}

export function buildBinlogDumpPacket(opts: {
  file: string;
  pos: number;
  serverId: number;
  flags?: number;
  seq?: number;
}): Buffer {
  const file = Buffer.from(opts.file, 'utf8');
  const payload = Buffer.alloc(1 + 4 + 2 + 4 + file.length);
  payload[0] = COM_BINLOG_DUMP;
  payload.writeUInt32LE(opts.pos >>> 0, 1);
  payload.writeUInt16LE(opts.flags ?? 0, 5);
  payload.writeUInt32LE(opts.serverId >>> 0, 7);
  file.copy(payload, 11);
  return wrapMysqlPacket(payload, opts.seq ?? 0);
}

function readCString(buf: Buffer, offset: number): { value: string; next: number } {
  const len = buf[offset] ?? 0;
  const start = offset + 1;
  const value = buf.subarray(start, start + len).toString('utf8');
  return { value, next: start + len + 1 };
}

function readBitmap(buf: Buffer, offset: number, nbits: number): { bits: boolean[]; next: number } {
  const nbytes = Math.ceil(nbits / 8);
  const bits: boolean[] = [];
  for (let i = 0; i < nbits; i++) {
    bits.push(((buf[offset + (i >> 3)] ?? 0) & (1 << (i & 7))) !== 0);
  }
  return { bits, next: offset + nbytes };
}

function metadataWidth(type: number): number {
  switch (type) {
    case MysqlType.FLOAT:
    case MysqlType.DOUBLE:
    case MysqlType.BLOB:
    case MysqlType.TINY_BLOB:
    case MysqlType.MEDIUM_BLOB:
    case MysqlType.LONG_BLOB:
    case MysqlType.GEOMETRY:
    case MysqlType.JSON:
    case MysqlType.TIMESTAMP2:
    case MysqlType.DATETIME2:
    case MysqlType.TIME2:
      return 1;
    case MysqlType.VARCHAR:
    case MysqlType.BIT:
    case MysqlType.NEWDECIMAL:
    case MysqlType.VAR_STRING:
    case MysqlType.STRING:
    case MysqlType.ENUM:
    case MysqlType.SET:
      return 2;
    default:
      return 0;
  }
}

export function sliceMetadata(types: number[], meta: Buffer): Buffer[] {
  const out: Buffer[] = [];
  let o = 0;
  for (const t of types) {
    const w = metadataWidth(t);
    out.push(meta.subarray(o, o + w));
    o += w;
  }
  return out;
}

function varcharLenBytes(meta: Buffer): number {
  const max = meta.length >= 2 ? meta.readUInt16LE(0) : (meta[0] ?? 0);
  return max >= 256 ? 2 : 1;
}

export function decodeMysqlValue(
  buf: Buffer,
  offset: number,
  type: number,
  meta: Buffer,
): { value: unknown; next: number } {
  switch (type) {
    case MysqlType.TINY:
      return { value: buf.readInt8(offset), next: offset + 1 };
    case MysqlType.SHORT:
      return { value: buf.readInt16LE(offset), next: offset + 2 };
    case MysqlType.INT24:
      return { value: buf.readIntLE(offset, 3), next: offset + 3 };
    case MysqlType.LONG:
      return { value: buf.readInt32LE(offset), next: offset + 4 };
    case MysqlType.LONGLONG:
      return { value: buf.readBigInt64LE(offset).toString(), next: offset + 8 };
    case MysqlType.FLOAT:
      return { value: buf.readFloatLE(offset), next: offset + 4 };
    case MysqlType.DOUBLE:
      return { value: buf.readDoubleLE(offset), next: offset + 8 };
    case MysqlType.YEAR:
      return { value: buf[offset]! + 1900, next: offset + 1 };
    case MysqlType.TIMESTAMP: {
      const sec = buf.readUInt32LE(offset);
      return { value: sec === 0 ? null : new Date(sec * 1000).toISOString(), next: offset + 4 };
    }
    case MysqlType.VARCHAR:
    case MysqlType.VAR_STRING:
    case MysqlType.STRING: {
      const nlen = type === MysqlType.VARCHAR ? varcharLenBytes(meta) : (meta.length >= 2 && meta.readUInt16LE(0) >= 256 ? 2 : 1);
      const len = nlen === 2 ? buf.readUInt16LE(offset) : buf[offset]!;
      const start = offset + nlen;
      return { value: buf.subarray(start, start + len).toString('utf8'), next: start + len };
    }
    case MysqlType.BLOB:
    case MysqlType.TINY_BLOB:
    case MysqlType.MEDIUM_BLOB:
    case MysqlType.LONG_BLOB:
    case MysqlType.JSON: {
      const nlen = meta[0] || 1;
      let len = 0;
      if (nlen === 1) len = buf[offset]!;
      else if (nlen === 2) len = buf.readUInt16LE(offset);
      else if (nlen === 3) len = buf.readUIntLE(offset, 3);
      else len = buf.readUInt32LE(offset);
      const start = offset + nlen;
      const slice = buf.subarray(start, start + len);
      if (type === MysqlType.JSON) return { value: slice.toString('utf8'), next: start + len };
      return { value: slice.toString('utf8'), next: start + len };
    }
    case MysqlType.DATETIME2: {
      const packed = buf.readUIntBE(offset, 5);
      const ymd = packed >> 17;
      const year = Math.floor(ymd / (13 * 32));
      const month = Math.floor(ymd / 32) % 13;
      const day = ymd % 32;
      const time = packed & 0x1ffff;
      const hour = Math.floor(time / 4096);
      const min = Math.floor(time / 64) % 64;
      const sec = time % 64;
      const fsp = meta[0] ?? 0;
      const fracBytes = Math.ceil(fsp / 2);
      return {
        value: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}Z`,
        next: offset + 5 + fracBytes,
      };
    }
    case MysqlType.TIMESTAMP2: {
      const sec = buf.readUInt32BE(offset);
      const fsp = meta[0] ?? 0;
      const fracBytes = Math.ceil(fsp / 2);
      return {
        value: sec === 0 ? null : new Date(sec * 1000).toISOString(),
        next: offset + 4 + fracBytes,
      };
    }
    case MysqlType.NEWDECIMAL: {
      const precision = meta[0] ?? 10;
      const scale = meta[1] ?? 0;
      const intg = precision - scale;
      const intg0 = Math.floor(intg / 9);
      const frac0 = Math.floor(scale / 9);
      const intg0x = intg - intg0 * 9;
      const frac0x = scale - frac0 * 9;
      const size = intg0 * 4 + frac0 * 4
        + (intg0x > 0 ? Math.ceil((intg0x + 1) / 2) : 0)  /* rough */
        + (frac0x > 0 ? Math.ceil((frac0x + 1) / 2) : 0);
      const next = offset + Math.max(1, size);
      return { value: buf.subarray(offset, next).toString('hex'), next };
    }
    default: {
      return { value: buf[offset] ?? null, next: offset + 1 };
    }
  }
}

export function encodeMysqlValue(type: number, value: unknown, meta: Buffer = Buffer.alloc(0)): Buffer {
  switch (type) {
    case MysqlType.TINY:
      return Buffer.from([Number(value) & 0xff]);
    case MysqlType.SHORT: {
      const b = Buffer.alloc(2);
      b.writeInt16LE(Number(value), 0);
      return b;
    }
    case MysqlType.LONG: {
      const b = Buffer.alloc(4);
      b.writeInt32LE(Number(value), 0);
      return b;
    }
    case MysqlType.LONGLONG: {
      const b = Buffer.alloc(8);
      b.writeBigInt64LE(BigInt(value as number | string), 0);
      return b;
    }
    case MysqlType.VARCHAR:
    case MysqlType.VAR_STRING: {
      const s = Buffer.from(String(value), 'utf8');
      const nlen = varcharLenBytes(meta.length ? meta : Buffer.from([64, 0]));
      const prefix = Buffer.alloc(nlen);
      if (nlen === 2) prefix.writeUInt16LE(s.length, 0);
      else prefix[0] = s.length;
      return Buffer.concat([prefix, s]);
    }
    default:
      throw new Error(`encodeMysqlValue: unsupported type ${type}`);
  }
}

function parseOptionalColumnNames(buf: Buffer, offset: number, end: number): string[] | undefined {
  let o = offset;
  let names: string[] | undefined;
  while (o < end) {
    const type = buf[o]!;
    o += 1;
    const len = readLenenc(buf, o);
    o = len.next;
    const data = buf.subarray(o, o + len.value);
    o += len.value;
    if (type === 4) {
      names = [];
      let p = 0;
      while (p < data.length) {
        const n = readLenenc(data, p);
        names.push(data.subarray(n.next, n.next + n.value).toString('utf8'));
        p = n.next + n.value;
      }
    }
  }
  return names;
}

export function encodeTableMapBody(opts: {
  tableId: number | bigint;
  schema: string;
  table: string;
  types: number[];
  metadata?: Buffer;
  columnNames?: string[];
}): Buffer {
  const tableId = Buffer.alloc(8);
  tableId.writeBigUInt64LE(BigInt(opts.tableId), 0);
  const schema = Buffer.from(opts.schema, 'utf8');
  const table = Buffer.from(opts.table, 'utf8');
  const types = Buffer.from(opts.types);
  const metadata = opts.metadata ?? Buffer.alloc(0);
  const nullBits = Buffer.alloc(Math.ceil(opts.types.length / 8));
  const parts = [
    tableId.subarray(0, 6),
    Buffer.from([0x01, 0x00]),
    Buffer.from([schema.length]),
    schema,
    Buffer.from([0]),
    Buffer.from([table.length]),
    table,
    Buffer.from([0]),
    writeLenenc(opts.types.length),
    types,
    writeLenenc(metadata.length),
    metadata,
    nullBits,
  ];
  if (opts.columnNames?.length) {
    const nameBufs: Buffer[] = [];
    for (const n of opts.columnNames) {
      const b = Buffer.from(n, 'utf8');
      nameBufs.push(writeLenenc(b.length), b);
    }
    const data = Buffer.concat(nameBufs);
    parts.push(Buffer.from([4]), writeLenenc(data.length), data);
  }
  return Buffer.concat(parts);
}

export function encodeRowsBody(opts: {
  tableId: number | bigint;
  v2?: boolean;
  columnCount: number;
  images: Array<{ values: Buffer[] }>;
}): Buffer {
  const tableId = Buffer.alloc(8);
  tableId.writeBigUInt64LE(BigInt(opts.tableId), 0);
  const bits = Buffer.alloc(Math.ceil(opts.columnCount / 8));
  for (let i = 0; i < opts.columnCount; i++) bits[i >> 3] |= 1 << (i & 7);
  const nullBits = Buffer.alloc(Math.ceil(opts.columnCount / 8));
  const rows = Buffer.concat(opts.images.map((img) => Buffer.concat([nullBits, ...img.values])));
  const extra = opts.v2 !== false ? Buffer.from([0x02, 0x00]) : Buffer.alloc(0);
  return Buffer.concat([
    tableId.subarray(0, 6),
    Buffer.from([0x00, 0x00]),
    extra,
    writeLenenc(opts.columnCount),
    bits,
    rows,
  ]);
}

function parseTableMap(body: Buffer): TableMap {
  const tableId = body.readBigUInt64LE(0) & 0xffffffffffffn;
  let o = 8;
  const schema = readCString(body, o);
  o = schema.next;
  const table = readCString(body, o);
  o = table.next;
  const col = readLenenc(body, o);
  o = col.next;
  const types = [...body.subarray(o, o + col.value)];
  o += col.value;
  const metaLen = readLenenc(body, o);
  o = metaLen.next;
  const metadata = body.subarray(o, o + metaLen.value);
  o += metaLen.value;
  const nullBytes = Math.ceil(col.value / 8);
  o += nullBytes;
  const columnNames = o < body.length ? parseOptionalColumnNames(body, o, body.length) : undefined;
  return { tableId, schema: schema.value, table: table.value, types, metadata, columnNames };
}

function decodeRowImage(
  buf: Buffer,
  offset: number,
  types: number[],
  metas: Buffer[],
  included: boolean[],
): { values: unknown[]; next: number } {
  const includedCount = included.filter(Boolean).length;
  const nullMap = readBitmap(buf, offset, includedCount);
  let o = nullMap.next;
  const values: unknown[] = [];
  let bit = 0;
  for (let i = 0; i < types.length; i++) {
    if (!included[i]) {
      values.push(undefined);
      continue;
    }
    if (nullMap.bits[bit]) {
      values.push(null);
      bit += 1;
      continue;
    }
    const decoded = decodeMysqlValue(buf, o, types[i]!, metas[i] ?? Buffer.alloc(0));
    values.push(decoded.value);
    o = decoded.next;
    bit += 1;
  }
  return { values, next: o };
}

function parseRows(type: number, body: Buffer, maps: Map<string, TableMap>): ParsedBinlogEvent['rows'] {
  const tableId = body.readBigUInt64LE(0) & 0xffffffffffffn;
  const v2 = type >= EventType.WRITE_ROWS;
  let o = 8;
  if (v2) {
    const extraLen = body.readUInt16LE(o);
    o += extraLen;
  }
  const col = readLenenc(body, o);
  o = col.next;
  const included = readBitmap(body, o, col.value);
  o = included.next;
  let includedAfter = included;
  const isUpdate = type === EventType.UPDATE_ROWS || type === EventType.UPDATE_ROWS_V1;
  if (isUpdate) {
    includedAfter = readBitmap(body, o, col.value);
    o = includedAfter.next;
  }
  const map = maps.get(tableId.toString());
  const types = map?.types ?? Array.from({ length: col.value }, () => MysqlType.LONG);
  const metas = map ? sliceMetadata(types, map.metadata) : types.map(() => Buffer.alloc(0));
  const op: CdcOp = type === EventType.DELETE_ROWS || type === EventType.DELETE_ROWS_V1
    ? 'delete'
    : isUpdate ? 'update' : 'insert';
  const rows: Array<{ before?: unknown[]; after?: unknown[] }> = [];
  while (o < body.length) {
    if (op === 'delete') {
      const img = decodeRowImage(body, o, types, metas, included.bits);
      rows.push({ before: img.values });
      o = img.next;
    } else if (op === 'update') {
      const before = decodeRowImage(body, o, types, metas, included.bits);
      const after = decodeRowImage(body, before.next, types, metas, includedAfter.bits);
      rows.push({ before: before.values, after: after.values });
      o = after.next;
    } else {
      const img = decodeRowImage(body, o, types, metas, included.bits);
      rows.push({ after: img.values });
      o = img.next;
    }
  }
  return { tableId, op, rows };
}

function parseGtid(body: Buffer): string {
  const sid = body.subarray(1, 17);
  const gno = body.readBigUInt64LE(17);
  const hex = sid.toString('hex');
  const uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  return `${uuid}:${gno.toString()}`;
}

export function parseBinlogEvent(
  buf: Buffer,
  opts: { checksumBytes?: number; tableMaps?: Map<string, TableMap> } = {},
): ParsedBinlogEvent {
  const checksumBytes = opts.checksumBytes ?? 0;
  const raw = checksumBytes > 0 ? buf.subarray(0, buf.length - checksumBytes) : buf;
  const header = parseEventHeader(raw);
  const payload = raw.subarray(19);
  const parsed: ParsedBinlogEvent = { header, type: header.type, payload };
  const maps = opts.tableMaps ?? new Map();
  if (header.type === EventType.ROTATE) {
    const pos = Number(payload.readBigUInt64LE(0));
    const file = payload.subarray(8).toString('utf8').replace(/\0+$/, '');
    parsed.rotate = { file, pos };
  } else if (header.type === EventType.GTID || header.type === EventType.ANONYMOUS_GTID) {
    parsed.gtid = parseGtid(payload);
  } else if (header.type === EventType.TABLE_MAP) {
    parsed.tableMap = parseTableMap(payload);
    maps.set(parsed.tableMap.tableId.toString(), parsed.tableMap);
  } else if (
    header.type === EventType.WRITE_ROWS
    || header.type === EventType.UPDATE_ROWS
    || header.type === EventType.DELETE_ROWS
    || header.type === EventType.WRITE_ROWS_V1
    || header.type === EventType.UPDATE_ROWS_V1
    || header.type === EventType.DELETE_ROWS_V1
  ) {
    parsed.rows = parseRows(header.type, payload, maps);
  }
  return parsed;
}

export function zipRow(names: string[] | undefined, values: unknown[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (let i = 0; i < values.length; i++) {
    const key = names?.[i] || `col_${i}`;
    out[key] = values[i];
  }
  return out;
}

export function rowsEventToChanges(
  parsed: ParsedBinlogEvent,
  tableMaps: Map<string, TableMap>,
  cursor: CdcCursor,
  columnNames?: Record<string, string[]>,
): CdcChange[] {
  if (!parsed.rows) return [];
  const map = tableMaps.get(parsed.rows.tableId.toString());
  if (!map) return [];
  const names = map.columnNames ?? columnNames?.[map.table];
  const occurredAt = parsed.header.timestamp
    ? new Date(parsed.header.timestamp * 1000)
    : undefined;
  return parsed.rows.rows.map((row, i) => ({
    table: map.table,
    op: parsed.rows!.op,
    after: row.after ? zipRow(names, row.after) : undefined,
    before: row.before ? zipRow(names, row.before) : undefined,
    cursor: { ...cursor, seq: (cursor.seq ?? 0) + i },
    occurredAt,
  }));
}

export function parseDumpPayload(
  payload: Buffer,
  state: { checksumBytes: number; tableMaps: Map<string, TableMap> },
): ParsedBinlogEvent | { error: string } | null {
  if (!payload.length) return null;
  const marker = payload[0]!;
  if (marker === 0xff) {
    const code = payload.length >= 3 ? payload.readUInt16LE(1) : 0;
    const msg = payload.subarray(3).toString('utf8');
    return { error: `mysql ${code}: ${msg}` };
  }
  if (marker === 0xfe) return null;
  const eventBuf = marker === 0x00 ? payload.subarray(1) : payload;
  if (eventBuf.length < 19) return null;
  const parsed = parseBinlogEvent(eventBuf, state);
  if (parsed.type === EventType.FORMAT_DESCRIPTION) {
    const alg = eventBuf[eventBuf.length - 5];
    if (alg === 1) state.checksumBytes = 4;
    if (alg === 0) state.checksumBytes = 0;
  }
  if (parsed.tableMap) {
    state.tableMaps.set(parsed.tableMap.tableId.toString(), parsed.tableMap);
  }
  return parsed;
}
