import { invokeDoAgent } from '../../integrations/ccs/ccs-client.js';
import { AppError } from '../../shared/errors/index.js';
export interface RemoteVoice {
  agentId: number;
  status: number;
  software?: boolean;
}
/** CCSCoreService DoGetTotalAgentInfo returns its current source-owned VDN summary synchronously. */
export async function remoteVoice(vdn: number, workNo: string): Promise<RemoteVoice | null> {
  let result: Awaited<ReturnType<typeof invokeDoAgent>>;
  try {
    result = await invokeDoAgent('DoGetTotalAgentInfo', { VDNID: vdn, MaxCount: 0 }, 10000, 1);
  } catch {
    throw new AppError(503, '无法确认 CCS 话务状态，请稍后重试');
  }
  const text = String(result.rsp.errMsg ?? '');
  if (Number(result.rsp.err) !== 0 || !/^count=\d+(?:;|$)/.test(text))
    throw new AppError(503, 'CCS 状态响应不可确认，请稍后重试');
  if (!text.split(';').includes('logoutGuard=1'))
    throw new AppError(503, 'CCS 尚未启用安全签出保护，请联系管理员部署匹配版本');
  const matches = text
    .split(';')
    .slice(1)
    .map((part) => /^agentId=(\d+),workNO=([^,]*),status=(\d+),vdnId=(\d+)(?:,|$)/.exec(part))
    .filter((m) => m && m[2] === workNo && Number(m[4]) === vdn);
  if (matches.length > 1) throw new AppError(409, '同一 VDN 的 CCS 工号状态不唯一，请联系管理员');
  if (!matches.length) return null;
  const found = matches[0]!;
  const status = Number(found[3]);
  if (status & (64 | 128 | 256 | 512 | 2048))
    throw new AppError(
      409,
      'CCS 存在振铃、通话、保持或活动呼叫，请结束后重试',
      'extension_call_active',
    );
  const item =
    text
      .split(';')
      .find((part) => part.startsWith('agentId=' + found[1] + ',workNO=' + workNo + ',')) ?? '';
  return status === 0
    ? null
    : { agentId: Number(found[1]), status, software: /,computerName=OmniAgent(?:,|$)/.test(item) };
}
