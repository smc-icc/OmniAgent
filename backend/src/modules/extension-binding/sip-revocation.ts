import { createConnection } from 'node:net';
import { randomBytes } from 'node:crypto';
import { database, execute, rows, transaction } from '../access/access.db.js';
import { AppError } from '../../shared/errors/index.js';
import type { Operation } from './repository.js';
import { ownedRevocationNumbers } from './policy.js';

/** Narrow ESL connection: authenticated API commands only, bounded bytes and lifetime, no logging of credentials. */
export function freeswitchApi(command: string): Promise<string> {
  const host = process.env.SIP_ESL_HOST,
    secret = process.env.SIP_ESL_PASSWORD;
  if (!host || !secret || /[\r\n]/.test(secret))
    throw new AppError(503, 'SIP 注册清理未配置，请配置 SIP_ESL_HOST / SIP_ESL_PASSWORD');
  if (/[\r\n]/.test(command)) throw new AppError(422, 'SIP 清理命令无效');
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host, port: Number(process.env.SIP_ESL_PORT || 8021) });
    let data = Buffer.alloc(0),
      authenticated = false,
      completed = false;
    const finish = (err?: Error, result?: string) => {
      if (completed) return;
      completed = true;
      socket.destroy();
      err ? reject(err) : resolve(result ?? '');
    };
    socket.setTimeout(10000, () => finish(new AppError(503, 'SIP 注册清理超时，请重试')));
    socket.on('error', () => finish(new AppError(503, '无法连接 SIP 注册服务，请重试')));
    socket.on('close', () => {
      if (!completed) finish(new AppError(503, 'SIP 注册服务关闭了连接'));
    });
    socket.on('data', (chunk) => {
      data = Buffer.concat([data, chunk]);
      if (data.length > 2 * 1024 * 1024) {
        finish(new AppError(503, 'SIP 注册服务响应过大'));
        return;
      }
      while (!completed) {
        let sep = data.indexOf('\n\n'),
          separatorSize = 2;
        const crlf = data.indexOf('\r\n\r\n');
        if (crlf >= 0 && (sep < 0 || crlf < sep)) {
          sep = crlf;
          separatorSize = 4;
        }
        if (sep < 0) return;
        const header = data.subarray(0, sep).toString('utf8');
        const length = Number(/Content-Length:\s*(\d+)/i.exec(header)?.[1] ?? 0);
        if (data.length < sep + separatorSize + length) return;
        const body = data.subarray(sep + separatorSize, sep + separatorSize + length).toString('utf8');
        data = data.subarray(sep + separatorSize + length);
        if (/Content-Type:\s*auth\/request/i.test(header)) {
          socket.write('auth ' + secret + '\n\n');
          continue;
        }
        if (!authenticated) {
          if (!/Reply-Text:\s*\+OK accepted/i.test(header)) {
            finish(new AppError(503, 'SIP 注册服务认证失败'));
            return;
          }
          authenticated = true;
          socket.write('api ' + command + '\n\n');
          continue;
        }
        if (/Content-Type:\s*api\/response/i.test(header)) {
          if (body.trim().startsWith('-ERR'))
            finish(new AppError(503, 'SIP 注册清理失败，请检查服务配置'));
          else finish(undefined, body);
          return;
        }
      }
    });
  });
}
export async function revokeSipCredentials(op: Operation) {
  const candidates=[...new Set([op.old_extension,op.target_extension].filter(Boolean))];
  if(!candidates.length)return;
  const placeholders=candidates.map(()=>'?').join(',');
  const owners=await rows<{num:string;vdn:number}>(await database(),'SELECT Num AS num,VDN AS vdn FROM t_icc_base_extension WHERE Num IN ('+placeholders+') UNION ALL SELECT username AS num,vdn_id AS vdn FROM t_icc_sip_directory WHERE username IN ('+placeholders+')',[...candidates,...candidates]);
  const nums=ownedRevocationNumbers(op.old_extension,op.target_extension,op.vdn_id,owners);
  if(!nums.length)return;
  // Check connectivity before changing credentials; registration removal is repeatable on restart.
  await freeswitchApi('status');
  const registrations = await rows<{ username: string; domain: string }>(
    await database(),
    'SELECT username,domain FROM t_icc_sip_directory WHERE username IN (' +
      nums.map(() => '?').join(',') +
      ') AND vdn_id=?',
    [...nums, op.vdn_id],
  );
  if (nums.includes(op.old_extension) && !registrations.some((r) => r.username === op.old_extension)) {
    const domain = process.env.SIP_REALM || process.env.SIP_SBC_HOST;
    if (!domain) throw new AppError(503, '旧分机不存在，需配置 SIP_REALM 后清理残留注册');
    registrations.push({ username: op.old_extension, domain });
  }
  const profile = process.env.SIP_ESL_PROFILE || 'internal';
  if (
    !/^[A-Za-z0-9_.-]+$/.test(profile) ||
    registrations.some(
      (r) => !/^[-A-Za-z0-9+*#_.]+$/.test(r.username) || !/^[-A-Za-z0-9_.:]+$/.test(r.domain),
    )
  )
    throw new AppError(503, 'SIP 注册清理参数无效');
  // Fail closed for active FreeSWITCH channels even if an Omni runtime was lost.
  const channelBody = await freeswitchApi('show channels as json');
  let channels: {
    row_count?: number;
    total_count?: number;
    rows?: Array<{ name?: string; cid_num?: string; dest?: string }>;
  };
  try {
    channels = JSON.parse(channelBody);
  } catch {
    throw new AppError(503, '无法确认 SIP 活动呼叫状态');
  }
  if (!Array.isArray(channels.rows) && Number(channels.row_count ?? channels.total_count) !== 0)
    throw new AppError(503, '无法确认 SIP 活动呼叫列表');
  if (
    channels.rows?.some((c) =>
      nums.some((n) => c.cid_num === n || c.dest === n || c.name?.includes('/' + n + '@')),
    )
  )
    throw new AppError(409, '存在活动 SIP 通话，通话结束后重试', 'extension_call_active');
  await transaction(async (db) => {
    for (const num of nums)
      await execute(db, 'UPDATE t_icc_sip_directory SET password=? WHERE username=? AND vdn_id=?', [
        randomBytes(32).toString('hex'),
        num,
        op.vdn_id,
      ]);
  });
  for (const r of registrations) {
    await freeswitchApi('xml_flush_cache id ' + r.username + ' ' + r.domain);
    await freeswitchApi(
      'sofia profile ' + profile + ' flush_inbound_reg ' + r.username + '@' + r.domain,
    );
    const contacts = (
      await freeswitchApi('sofia_contact ' + profile + '/' + r.username + '@' + r.domain)
    ).trim();
    if (contacts && !contacts.startsWith('error/') && !contacts.startsWith('-ERR'))
      throw new AppError(503, '旧 SIP 注册尚未清理，请重试');
  }
}
