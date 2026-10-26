import type { HubTransformConfig } from '../config/schema.js';
import type { BusinessEvent } from '../contract/event.js';
import { getJsonPath } from './json-path.js';

export class TransformError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TransformError';
  }
}

export type TargetRecord = Record<string, unknown>;

export function transformEvent(
  event: BusinessEvent,
  name: string,
  transforms: Record<string, HubTransformConfig>,
): TargetRecord[] {
  if (name === 'passthrough') return [{ ...event } as unknown as TargetRecord];
  const spec = transforms[name];
  if (!spec) throw new TransformError(`未注册的 transform: ${name}`);
  if (spec.kind === 'passthrough') return [{ ...event } as unknown as TargetRecord];
  if (spec.kind === 'module') {
    throw new TransformError(`module transform 尚未实现: ${spec.module ?? name}`);
  }
  const fields = spec.fields ?? {};
  const row: TargetRecord = {};
  if (spec.fromPayload) {
    const payload = event.payload;
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
      for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
        if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) continue;
        row[k.toLowerCase()] = v ?? null;
      }
      const aliases: Record<string, string> = {
        callernumber: 'callingno',
        calleenumber: 'calledno',
        duration: 'talktimelong',
      };
      for (const [from, to] of Object.entries(aliases)) {
        if ((row[to] === undefined || row[to] === null) && row[from] != null) row[to] = row[from];
      }
    }
  }
  for (const [key, specField] of Object.entries(fields)) {
    const expr = typeof specField === 'string' ? specField : specField.expr;
    const required = typeof specField === 'object' && specField.required;
    const fallback = typeof specField === 'object' ? specField.default : undefined;
    const cast = typeof specField === 'object' ? specField.cast : undefined;
    let value: unknown;
    try {
      value = getJsonPath(event, expr);
    } catch (err) {
      throw new TransformError(`字段 ${key}: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (value === undefined || value === null) {
      if (fallback !== undefined) value = fallback;
    }
    if ((value === undefined || value === null) && required) {
      throw new TransformError(`必填字段缺失: ${key} (${expr})`);
    }
    if (value !== undefined && value !== null && cast) value = castValue(value, cast);
    row[key] = value ?? null;
  }
  if (spec.target?.table) row.__hub_table = spec.target.table;
  return [row];
}

function castValue(value: unknown, cast: string): unknown {
  switch (cast) {
    case 'int':
    case 'integer':
      return Number.parseInt(String(value), 10);
    case 'float':
    case 'number':
      return Number(value);
    case 'string':
      return String(value);
    case 'timestamptz':
    case 'datetime':
      return new Date(String(value)).toISOString();
    case 'unix_ts': {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) return null;
      const ms = n > 1e12 ? n : n * 1000;
      return new Date(ms).toISOString();
    }
    case 'bool':
    case 'boolean':
      return value === true || value === 'true' || value === 1 || value === '1';
    default:
      return value;
  }
}
