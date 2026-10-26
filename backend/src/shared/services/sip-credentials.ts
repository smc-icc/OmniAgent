import { env } from '../../config/env.js';
import { AppError } from '../errors/index.js';
import { database, rows, execute, transaction } from '../../modules/access/access.db.js';
import { getSessionByUserId } from '../../integrations/ccs/session-manager.js';
import { confTenancyEnabled } from './conf-tenancy.js';
import { resolveVoiceActor, type VoiceActor } from './voice-tenant.js';
import { getLoginSession } from './login-session.js';
import { assertVoiceIdle } from '../../modules/extension-binding/policy.js';
import { freeswitchApi } from '../../modules/extension-binding/sip-revocation.js';
import { readVideoAgentConfig, validateVideoExtension, type VideoAgentConfig, type VideoConfigState } from './video-agent-config.js';
import { selectVideoRouting, type VideoRoutingRow } from '../../modules/video/video-agent-routing.js';
import { browserSipSettings, parseVideoEntries } from '../../modules/video/video-customer.policy.js';

/**
 * 移动坐席的 SIP 接入参数。
 * 账号密码取自 ConfServer 维护的 `t_icc_sip_directory`（FreeSWITCH xml_curl directory 的同一张表），
 * 网络参数取自环境变量，因为 App 只允许连对外 SBC，不直连内网 FreeSWITCH。
 */
export interface SipCredentials {
  purpose: 'voice' | 'video';
  allow_video: boolean;
  video_config: VideoAgentConfig;
  identity: { user_id: number; account_id: number; vdn_id: number };
  username: string;
  password: string;
  realm: string;
  proxy: { host: string; port: number; transport: 'tls' | 'tcp' | 'udp' };
  srtp: 'required' | 'optional' | 'disabled';
  codecs: string[];
  register_expires_s: number;
  stun_server: string;
  ice_enabled: boolean;
  /** 凭据建议的重新拉取时间；App 只在内存与系统 Keystore 里保留到此刻 */
  expires_at: string;
  binding_version?: number;
  login_sid?: string;
  web?: ReturnType<typeof browserSipSettings>;
  video?: { group_ids: number[]; skill_ids: number[] };
}

function normalizeTransport(raw: string): 'tls' | 'tcp' | 'udp' {
  return raw === 'tcp' || raw === 'udp' ? raw : 'tls';
}

function normalizeSrtp(raw: string): 'required' | 'optional' | 'disabled' {
  return raw === 'optional' || raw === 'disabled' ? raw : 'required';
}

/** 受管模式必须使用当前分机绑定；旧签入会话不能借用同 VDN 的其他分机。 */
async function resolveExtension(userId: number, workNo: string, vdnId: number, sourceUserId: number): Promise<string> {
  const session = getSessionByUserId(userId);
  if (confTenancyEnabled() && session?.extension?.trim()
    && (session.vdnId !== vdnId || session.workNO !== workNo)) {
    throw new AppError(403, '签入分机不属于当前话务身份');
  }
  const signedIn = session?.loggedIn ? session.extension?.trim() : undefined;

  const db = await database();
  const bound = await rows<{ extension: string }>(
    db,
    `SELECT COALESCE(u.ExtensionTel, '') AS extension
       FROM t_user_users u
      WHERE u.WorkNO = ? AND u.VDNID = ? AND u.IsValid = 1${confTenancyEnabled() ? ' AND u.ID = ?' : ''}`,
    confTenancyEnabled() ? [workNo, vdnId, sourceUserId] : [workNo, vdnId],
  );
  const extensions = [...new Set(bound.map(row => row.extension?.trim()).filter(Boolean))];
  if (extensions.length > 1) throw new AppError(409, '坐席分机绑定不唯一，请在配置中心确认');
  const extension = extensions[0] ?? '';
  if (!extension) throw new AppError(409, '该坐席未绑定分机，请先在操作员管理里配置分机号');
  if (signedIn && signedIn !== extension) {
    throw new AppError(409, '签入分机与当前绑定不一致，请退出话务后重新签入');
  }
  return extension;
}

export async function getSipCredentials(input: {
  userId: number;
  workNo: string;
  vdnId: number;
  purpose?: 'voice' | 'video' | 'auto';
  client?: 'web' | 'mobile';
}): Promise<SipCredentials> {
  const requestedPurpose = input.purpose ?? 'voice';
  const client = input.client ?? 'mobile';
  if (!['voice', 'video', 'auto'].includes(requestedPurpose) || !['web', 'mobile'].includes(client)) {
    throw new AppError(400, 'purpose 或 client 无效');
  }
  if (!env.SIP_SBC_HOST) throw new AppError(503, 'SIP 接入未配置（SIP_SBC_HOST 为空）');
  const actor = await resolveVoiceActor(input);
  if (confTenancyEnabled() && (env.SIP_SBC_TRANSPORT !== 'tls' || env.SIP_SRTP !== 'required')) {
    throw new AppError(503, '受管话务必须使用 TLS 和强制 SRTP');
  }

  const db = await database();
  const state = await readVideoAgentConfig(actor, db);
  const config = state.config;
  const webVideoPermitted = config.enabled && config.web_video_enabled;
  if (client === 'web' && requestedPurpose === 'voice' && !config.web_sip_enabled) {
    throw new AppError(403, '当前坐席未开启浏览器话机');
  }
  if (client === 'web' && requestedPurpose === 'video' && !webVideoPermitted) {
    throw new AppError(403, '当前坐席未开启 Web 视频');
  }
  if (client === 'mobile' && requestedPurpose === 'video') {
    throw new AppError(403, '移动端使用绑定电话分机，视频能力由来电媒体类型决定');
  }
  // Mobile always uses the bound telephone identity and advertises video capability.
  const purpose = client === 'mobile' ? 'voice'
    : requestedPurpose === 'video' || (requestedPurpose === 'auto' && webVideoPermitted) ? 'video' : 'voice';
  // Independent video does not require or change the ordinary telephone binding.
  const independent = purpose === 'video' && config.video_extension_mode === 'independent_video';
  const username = independent ? config.extension
    : await resolveExtension(actor.userId, actor.workNo, actor.vdnId, state.sourceUserId);
  if (purpose === 'video') {
    assertVideoSessionActor(actor);
    await validateVideoExtension(db, actor, state);
  }
  const realm = env.SIP_REALM || env.SIP_SBC_HOST;
  let bindingVersion: number | undefined = purpose === 'video' ? 0 : undefined;
  let loginSid: string | undefined = purpose === 'video' ? getLoginSession(actor.userId)?.sessionId : undefined;
  if (purpose === 'video' && !loginSid) throw new AppError(401, '登录会话已失效');
  if (process.env.OMNI_EXTENSION_BINDING_ENABLED === '1') {
    const { readBinding, bindingConflict, activeOperation } = await import('../../modules/extension-binding/repository.js');
    const b = await readBinding(db,actor.vdnId,state.sourceUserId);
    const conflict = independent ? null : await bindingConflict(db,actor.vdnId,b);
    if (conflict || await activeOperation(db,actor.vdnId,b.user_id)) throw new AppError(409,conflict || '分机正在变更，请稍后重试');
    bindingVersion=b.version; loginSid=getLoginSession(actor.userId)?.sessionId;
    if (!loginSid) throw new AppError(401,'登录会话已失效');
  }

  if (confTenancyEnabled()) {
    const owners = await rows<{ vdn: number; enabled: number }>(db,
      'SELECT VDN AS vdn, IsValid AS enabled FROM t_icc_base_extension WHERE Num = ?', [username]);
    if (owners.length !== 1 || Number(owners[0]!.vdn) !== actor.vdnId || Number(owners[0]!.enabled) !== 1) {
      throw new AppError(403, '分机不存在、停用或不属于当前 VDN');
    }
  }
  let account: { password: string; domain: string } | undefined;
  try {
    [account] = await rows<{ password: string; domain: string }>(
      db,
      `SELECT d.password, d.domain FROM t_icc_sip_directory d
        JOIN t_icc_base_extension e ON e.Num = d.username AND e.VDN = d.vdn_id
        WHERE d.username = ? AND d.vdn_id = ? AND d.domain = ?
          AND d.enabled = 1 AND e.IsValid = 1
        LIMIT 1`,
      [username, actor.vdnId, realm],
    );
  } catch (err) {
    if (['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes((err as { code?: string }).code ?? '')) {
      throw new AppError(503, 'SIP 主从表尚未迁移，请先运行分机目录迁移');
    }
    throw err;
  }
  if (!account?.password) {
    throw new AppError(409, `分机 ${username} 未配置 SIP 账号，请先在配置中心维护 SIP 注册信息`);
  }

  let video: { group_ids: number[]; skill_ids: number[] } | undefined;
  if (purpose === 'video' && env.VIDEO_CUSTOMER_ENABLED) {
    const routes = await rows<VideoRoutingRow>(db, `SELECT DISTINCT r.VDNID AS vdn_id, a.Code AS access_code,
      r.GroupID AS group_id, r.DeviceID AS skill_id
      FROM t_icc_vdn_serviceroute r JOIN t_icc_base_accesscode a ON a.ID=r.AccessCodeID AND a.VDNID=r.VDNID
      JOIN t_user_usertogroup g ON g.GroupID=r.GroupID AND g.UserID=? AND g.VDNID=r.VDNID
      JOIN t_icc_skill_skilltouser s ON s.SkillID=r.DeviceID AND s.UserID=?
      WHERE r.IsValid=1 AND r.DeviceType=2 AND r.VDNID=?`, [state.sourceUserId,String(state.sourceUserId),actor.vdnId]);
    video = selectVideoRouting(parseVideoEntries(env.VIDEO_ENTRIES_JSON), actor.vdnId, routes);
  }
  const web = env.SIP_WSS_URL ? browserSipSettings(env.SIP_WSS_URL, env.SIP_ICE_SERVERS_JSON) : undefined;
  if (purpose === 'video') {
    account = await claimVideoRegistration(actor, state, username, realm, client, loginSid!);
  }
  return {
    purpose,
    allow_video: client === 'mobile' || purpose === 'video' || (client === 'web'
      && config.enabled && config.web_video_enabled && config.video_extension_mode === 'shared_phone'
      && username === config.phone_extension),
    video_config: config,
    ...(video ? { video } : {}),
    identity: { user_id: actor.userId, account_id: actor.accountId, vdn_id: actor.vdnId },
    username,
    binding_version: bindingVersion,
    login_sid: loginSid,
    password: account.password,
    realm: account.domain,
    proxy: {
      host: env.SIP_SBC_HOST,
      port: env.SIP_SBC_PORT,
      transport: normalizeTransport(env.SIP_SBC_TRANSPORT),
    },
    srtp: normalizeSrtp(env.SIP_SRTP),
    codecs: env.SIP_CODECS.split(',').map((c) => c.trim()).filter(Boolean),
    register_expires_s: Math.max(60, env.SIP_REGISTER_EXPIRES_S),
    stun_server: env.SIP_STUN_SERVER,
    ice_enabled: env.SIP_ICE_ENABLED,
    expires_at: new Date(Date.now() + Math.max(300, env.SIP_CREDENTIALS_TTL_S) * 1000).toISOString(),
    ...(web ? { web } : {}),
  };
}

/** Serialize claims with voice binding writers, and keep the row locked across the contact check. */
async function claimVideoRegistration(actor: VoiceActor, expected: VideoConfigState, username: string,
  realm: string, client: 'web' | 'mobile', loginSid: string): Promise<{ password: string; domain: string }> {
  return transaction(async db => {
    const current = await readVideoAgentConfig(actor, db, true);
    if (current.sourceUserId !== expected.sourceUserId || JSON.stringify(current.config) !== JSON.stringify(expected.config)) {
      throw new AppError(409, '视频配置已变更，请重新获取');
    }
    await validateVideoExtension(db, actor, current);
    const [account] = await rows<{ password: string; domain: string }>(db,
      `SELECT d.password, d.domain FROM t_icc_sip_directory d
       JOIN t_icc_base_extension e ON e.Num=d.username AND e.VDN=d.vdn_id
       WHERE d.username=? AND d.vdn_id=? AND d.domain=? AND d.enabled=1 AND e.IsValid=1
       LIMIT 1 FOR UPDATE`, [username, actor.vdnId, realm]);
    if (!account?.password) throw new AppError(409, '视频分机未配置有效 SIP 凭据');
    const sameClaim = current.registrationSid === loginSid && current.registrationClient === client;
    const checkIdentity = () => {
      if (getLoginSession(actor.userId)?.sessionId !== loginSid) throw new AppError(401, '登录会话已失效');
      assertVideoSessionActor(actor);
      const session = getSessionByUserId(actor.userId);
      // A shared native account is already the selected identity. Refreshes do not switch it.
      if (!sameClaim && !(current.config.same_extension && session?.extension === username)) assertVoiceIdle(session);
    };
    checkIdentity();
    const profile = process.env.SIP_ESL_PROFILE || 'internal';
    if (!/^[A-Za-z0-9_.-]+$/.test(profile) || !/^[0-9+*#]+$/.test(username) || !/^[A-Za-z0-9_.:-]+$/.test(realm)) {
      throw new AppError(503, 'SIP 注册检查参数无效');
    }
    const contacts = (await freeswitchApi('sofia_contact ' + profile + '/' + username + '@' + realm)).trim();
    const unregistered = contacts.toLowerCase() === 'error/user_not_registered';
    if (!unregistered && !/^(sofia\/|sips?:)/i.test(contacts)) throw new AppError(503, '无法确认视频分机注册状态');
    if (!unregistered && !sameClaim) throw new AppError(409, '视频分机已有其他终端注册，不能接管', 'video_registration_occupied');
    checkIdentity();
    await execute(db,
      'UPDATE t_icc_agent_video_config SET RegistrationSid=?, RegistrationClient=? WHERE VDNID=? AND UserID=? AND Revision=?',
      [loginSid, client, actor.vdnId, current.sourceUserId, current.config.revision]);
    return account;
  });
}

function assertVideoSessionActor(actor: VoiceActor) {
  const session = getSessionByUserId(actor.userId);
  if (session?.loggedIn && (session.vdnId !== actor.vdnId || session.workNO !== actor.workNo)) {
    throw new AppError(403, '签入会话不属于当前话务身份');
  }
}
