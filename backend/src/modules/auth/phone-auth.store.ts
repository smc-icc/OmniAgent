import type Redis from 'ioredis';
import type { PhoneChallenge, PhoneChallengeStore, PhoneSelection } from './phone-auth.service.js';
const root = 'omni:phone-auth:';
const key = (id: string) => root + 'challenge:' + id;
function parse(raw: unknown): PhoneChallenge | null {
  if (typeof raw !== 'string') return null;
  try {
    const r = JSON.parse(raw) as PhoneChallenge;
    if (!r || !/^[a-f0-9-]{36}$/.test(r.id) || ![r.phoneHash, r.codeHash, r.deviceHash].every(h => /^[a-f0-9]{64}$/.test(h)) ||
      r.version !== 2 || !Number.isSafeInteger(r.attempts) || r.attempts < 0 || !Number.isSafeInteger(r.expiresAt) || !['ready', 'pending'].includes(r.state)) return null;
    return r;
  } catch { return null; }
}
const reserve = `
if redis.call('EXISTS',KEYS[2])==1 then return 0 end
local old=redis.call('GET',KEYS[3])
if old then redis.call('DEL',ARGV[1]..'challenge:'..old) end
redis.call('SET',KEYS[1],ARGV[2],'EX',ARGV[3])
redis.call('SET',KEYS[2],ARGV[4],'EX',ARGV[5])
redis.call('SET',KEYS[3],ARGV[4],'EX',ARGV[3])
return 1`;
const activate = `
local raw=redis.call('GET',KEYS[1]);if not raw then return 0 end
local ttl=redis.call('PTTL',KEYS[1]);if ttl<=0 then return 0 end
local r=cjson.decode(raw);r.state='ready'
redis.call('SET',KEYS[1],cjson.encode(r),'PX',ttl);return 1`;
const verify = `
local raw=redis.call('GET',KEYS[1]);if not raw then return nil end
local r=cjson.decode(raw)
if r.expiresAt<=tonumber(ARGV[1]) then redis.call('DEL',KEYS[1]);return nil end
if r.version~=2 or r.state~='ready' or r.phoneHash~=ARGV[2] or r.deviceHash~=ARGV[3] then return nil end
if r.attempts>=5 then redis.call('DEL',KEYS[1]);return nil end
if r.codeHash~=ARGV[4] then
 r.attempts=r.attempts+1
 if r.attempts>=5 then redis.call('DEL',KEYS[1]) else
  local ttl=redis.call('PTTL',KEYS[1]);if ttl>0 then redis.call('SET',KEYS[1],cjson.encode(r),'PX',ttl) end
 end
 return nil
end
redis.call('DEL',KEYS[1]);return raw`;
const consumeSelection = `
local raw=redis.call('GET',KEYS[1]);if not raw then return nil end
local r=cjson.decode(raw)
if r.expiresAt<=tonumber(ARGV[1]) then redis.call('DEL',KEYS[1]);return nil end
if r.phoneHash~=ARGV[2] or r.deviceHash~=ARGV[3] then return nil end
local allowed=false;for _,t in ipairs(r.targets) do if t.vdnId==tonumber(ARGV[4]) then allowed=true end end
if not allowed then return nil end
redis.call('DEL',KEYS[1]);return raw`;
function parseSelection(raw: unknown): PhoneSelection | null {
  if (typeof raw !== 'string') return null;
  try {
    const r = JSON.parse(raw) as PhoneSelection;
    if (!r || ![r.phoneHash, r.deviceHash].every(h => /^[a-f0-9]{64}$/.test(h)) || !Number.isSafeInteger(r.expiresAt) ||
      !Array.isArray(r.targets) || !r.targets.length || !r.targets.every(t => [t.userId, t.accountId, t.vdnId, t.operatorId].every(n => Number.isSafeInteger(n) && n > 0))) return null;
    return r;
  } catch { return null; }
}
export function redisPhoneChallengeStore(redis: Redis): PhoneChallengeStore {
  return {
    reserve: async (r, ttl, cooldown) => Number(await redis.eval(reserve, 3, key(r.id), root + 'cooldown:' + r.phoneHash,
      root + 'active:' + r.phoneHash, root, JSON.stringify(r), ttl, r.id, cooldown)) === 1,
    activate: async id => { await redis.eval(activate, 1, key(id)); },
    discard: async id => { await redis.del(key(id)); },
    verify: async (id, proof) => parse(await redis.eval(verify, 1, key(id), proof.now, proof.phoneHash, proof.deviceHash, proof.codeHash)),
    saveSelection: async (hash, r, ttl) => { await redis.set(root + 'selection:' + hash, JSON.stringify(r), 'EX', ttl); },
    consumeSelection: async (hash, p) => parseSelection(await redis.eval(consumeSelection, 1, root + 'selection:' + hash, p.now, p.phoneHash, p.deviceHash, p.vdnId)),
    limit: async (scope, max, seconds) => Number(await redis.eval("local n=redis.call('INCR',KEYS[1]);if n==1 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end;return n", 1, root + 'limit:' + scope, seconds)) <= max,
  };
}
