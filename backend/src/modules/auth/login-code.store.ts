import type Redis from 'ioredis';
import type { LoginCodeRecord, LoginCodeStore, LoginCodeTarget } from './login-code.service.js';

const prefix = 'omni:login-code:';
const recordKey = (id: string) => prefix + 'record:' + id;
const tokenKey = (hash: string) => prefix + 'token:' + hash;
const indexKey = (target: Omit<LoginCodeTarget, 'userId'>) => `${prefix}seat:${target.accountId}:${target.vdnId}:${target.operatorId}`;
function parse(value: unknown): LoginCodeRecord | null {
  if (typeof value !== 'string') return null;
  try {
    const r = JSON.parse(value) as LoginCodeRecord;
    if (!r || !/^[a-f0-9-]{36}$/.test(r.id) || !/^[a-f0-9]{64}$/.test(r.tokenHash) ||
      ![r.userId, r.accountId, r.vdnId, r.operatorId, r.issuerId, r.issuedAt, r.expiresAt].every(n => Number.isSafeInteger(n) && n > 0)) return null;
    return r;
  } catch { return null; }
}
const consumeScript = `
local id = redis.call('GET', KEYS[1])
if not id then return nil end
local recordKey = ARGV[1] .. 'record:' .. id
local raw = redis.call('GET', recordKey)
redis.call('DEL', KEYS[1], recordKey)
if raw then
  local r = cjson.decode(raw)
  redis.call('ZREM', ARGV[1] .. 'seat:' .. r.accountId .. ':' .. r.vdnId .. ':' .. r.operatorId, id)
end
return raw`;
const issueScript = `
redis.call('ZREMRANGEBYSCORE', KEYS[3], '-inf', ARGV[4])
if redis.call('ZCARD', KEYS[3]) >= 5 then return 0 end
if redis.call('EXISTS', KEYS[1], KEYS[2]) > 0 then return 0 end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[3])
redis.call('ZADD', KEYS[3], ARGV[5], ARGV[2])
redis.call('EXPIRE', KEYS[3], ARGV[3])
return 1`;
const revokeScript = `
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
redis.call('DEL', KEYS[1], KEYS[2])
redis.call('ZREM', KEYS[3], ARGV[2])
return 1`;
export function redisLoginCodeStore(redis: Redis): LoginCodeStore {
  return {
    put: async (record, ttl) => Number(await redis.eval(issueScript, 3, recordKey(record.id), tokenKey(record.tokenHash), indexKey(record),
      JSON.stringify(record), record.id, ttl, record.issuedAt, record.expiresAt)) === 1,
    take: async hash => parse(await redis.eval(consumeScript, 1, tokenKey(hash), prefix)),
    get: async id => parse(await redis.get(recordKey(id))),
    list: async target => {
      const ids = await redis.zrangebyscore(indexKey(target), Date.now(), '+inf');
      if (!ids.length) return [];
      return (await redis.mget(...ids.map(recordKey))).map(parse).filter((r): r is LoginCodeRecord => r !== null &&
        r.accountId === target.accountId && r.vdnId === target.vdnId && r.operatorId === target.operatorId);
    },
    revoke: async record => Number(await redis.eval(revokeScript, 3, tokenKey(record.tokenHash), recordKey(record.id), indexKey(record), record.id, record.id)) === 1,
    limit: async (key, max, seconds) => Number(await redis.eval("local n=redis.call('INCR',KEYS[1]); if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]); end; return n", 1, prefix + 'limit:' + key, seconds)) <= max,
  };
}
