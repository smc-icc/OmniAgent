import { env } from '../../config/env.js';
import { database, rows, type Db } from '../../modules/access/access.db.js';
import { AppError } from '../errors/index.js';
import { resolveVoiceActor, type VoiceActor, type VoiceActorInput } from './voice-tenant.js';

export type VideoExtensionMode = 'shared_phone' | 'independent_video';

export interface VideoAgentConfig {
  enabled: boolean;
  same_extension: boolean;
  phone_extension: string;
  extension: string;
  web_sip_enabled: boolean;
  web_video_enabled: boolean;
  video_extension_mode: VideoExtensionMode;
  web_enabled: boolean; // legacy alias for web_video_enabled
  mobile_enabled: boolean; // legacy field retained for old clients; mobile identity no longer uses it
  password_configured: boolean;
  revision: number;
}
export interface VideoConfigState {
  config: VideoAgentConfig;
  sourceUserId: number;
  registrationSid: string | null;
  registrationClient: string | null;
}
interface ConfigRow {
  enabled: number; same_extension: number; video_extension: string | null;
  web_enabled: number; mobile_enabled: number; web_sip_enabled?: number; web_video_enabled?: number; video_extension_mode?: string; revision: number;
  registration_sid: string | null; registration_client: string | null;
}
function missingVideoSchema(error: unknown) {
  return ['ER_NO_SUCH_TABLE', 'ER_BAD_FIELD_ERROR'].includes((error as { code?: string }).code ?? '');
}

/** Config reads contain only the existence of a directory password, never the password itself. */
export async function readVideoAgentConfig(actor: VoiceActor, db: Db, lock = false): Promise<VideoConfigState> {
  const users = await rows<{ source_user_id: number; phone_extension: string }>(db,
    `SELECT u.ID AS source_user_id, COALESCE(u.ExtensionTel, '') AS phone_extension
     FROM t_user_users u WHERE u.VDNID=? AND u.IsValid=1 AND ${actor.sourceUserId > 0 ? 'u.ID=?' : 'u.WorkNO=?'}${lock ? ' FOR UPDATE' : ''}`,
    [actor.vdnId, actor.sourceUserId > 0 ? actor.sourceUserId : actor.workNo]);
  if (actor.vdnId <= 0 || users.length !== 1 || !Number(users[0]!.source_user_id)) {
    throw new AppError(403, '当前 VDN 坐席身份无效');
  }
  const sourceUserId = Number(users[0]!.source_user_id);
  const config: VideoAgentConfig = { enabled: false, same_extension: false,
    phone_extension: String(users[0]!.phone_extension ?? '').trim(), extension: '',
    web_sip_enabled: false, web_video_enabled: false, video_extension_mode: 'shared_phone',
    web_enabled: false, mobile_enabled: false, password_configured: false, revision: 0 };
  const state: VideoConfigState = { config, sourceUserId, registrationSid: null, registrationClient: null };
  let row: ConfigRow | undefined;
  try {
    try {
      [row] = await rows<ConfigRow>(db,
        `SELECT Enabled AS enabled, SameExtension AS same_extension, VideoExtension AS video_extension,
         WebEnabled AS web_enabled, MobileEnabled AS mobile_enabled, WebSipEnabled AS web_sip_enabled,
         WebVideoEnabled AS web_video_enabled, VideoExtensionMode AS video_extension_mode,
         Revision AS revision, RegistrationSid AS registration_sid, RegistrationClient AS registration_client
         FROM t_icc_agent_video_config WHERE VDNID=? AND UserID=?${lock ? ' FOR UPDATE' : ''}`,
        [actor.vdnId, sourceUserId]);
    } catch (error) {
      if ((error as { code?: string }).code !== 'ER_BAD_FIELD_ERROR') throw error;
      [row] = await rows<ConfigRow>(db,
        `SELECT Enabled AS enabled, SameExtension AS same_extension, VideoExtension AS video_extension,
         WebEnabled AS web_enabled, MobileEnabled AS mobile_enabled, Revision AS revision,
         RegistrationSid AS registration_sid, RegistrationClient AS registration_client
         FROM t_icc_agent_video_config WHERE VDNID=? AND UserID=?${lock ? ' FOR UPDATE' : ''}`,
        [actor.vdnId, sourceUserId]);
    }
  } catch (error) {
    if (missingVideoSchema(error) && !lock) return state;
    throw error;
  }
  if (!row) return state;
  config.enabled = Number(row.enabled) === 1;
  config.same_extension = Number(row.same_extension) === 1;
  config.extension = config.same_extension ? config.phone_extension : String(row.video_extension ?? '').trim();
  config.web_sip_enabled = Number(row.web_sip_enabled) === 1;
  config.web_video_enabled = row.web_video_enabled == null ? Number(row.web_enabled) === 1 : Number(row.web_video_enabled) === 1;
  config.video_extension_mode = row.video_extension_mode === 'independent_video' || !config.same_extension ? 'independent_video' : 'shared_phone';
  config.web_enabled = config.web_video_enabled;
  config.mobile_enabled = Number(row.mobile_enabled) === 1;
  config.revision = Number(row.revision) || 0;
  state.registrationSid = row.registration_sid;
  state.registrationClient = row.registration_client;
  if (config.extension) {
    const [directory] = await rows<{ password_configured: number }>(db,
      `SELECT EXISTS(SELECT 1 FROM t_icc_sip_directory d
       JOIN t_icc_base_extension e ON e.Num=d.username AND e.VDN=d.vdn_id
       WHERE d.username=? AND d.vdn_id=? AND d.domain=? AND d.enabled=1 AND e.IsValid=1
       AND d.password<>'') AS password_configured`,
      [config.extension, actor.vdnId, env.SIP_REALM || env.SIP_SBC_HOST]);
    config.password_configured = Number(directory?.password_configured) === 1;
  }
  return state;
}
export async function getVideoAgentConfig(input: VoiceActorInput): Promise<VideoAgentConfig> {
  const actor = await resolveVoiceActor(input);
  return (await readVideoAgentConfig(actor, await database())).config;
}

/** Independent video identities are reserved even while video is disabled. */
export async function assertVideoExtensionAvailable(db: Db, extension: string) {
  if (!extension) return;
  let reserved;
  try {
    reserved = await rows(db,
      'SELECT UserID FROM t_icc_agent_video_config WHERE VideoExtension=? AND SameExtension=0 LIMIT 1', [extension]);
  } catch (error) {
    if (missingVideoSchema(error)) return; // Pre-migration deployments have no video reservations.
    throw error;
  }
  if (reserved.length) throw new AppError(409, '分机已保留为独立视频分机', 'extension_video_reserved');
}

/** Validate global uniqueness as well as the exact tenant; never borrow an alternate VDN. */
export async function validateVideoExtension(db: Db, actor: VoiceActor, state: VideoConfigState) {
  const { config, sourceUserId } = state;
  const extension = config.extension;
  if (!extension) throw new AppError(409, '视频分机尚未配置');
  if (!config.same_extension && extension === config.phone_extension) {
    throw new AppError(409, '独立视频分机不能使用电话分机');
  }
  const owners = await rows<{ vdn: number; enabled: number }>(db,
    'SELECT VDN AS vdn, IsValid AS enabled FROM t_icc_base_extension WHERE Num = ?', [extension]);
  if (owners.length !== 1 || Number(owners[0]!.vdn) !== actor.vdnId || Number(owners[0]!.enabled) !== 1) {
    throw new AppError(403, '视频分机不存在、停用或不属于当前 VDN');
  }
  const occupied = await rows(db,
    `SELECT ID FROM t_user_users WHERE ExtensionTel=? ${config.same_extension ? 'AND NOT (ID=? AND VDNID=?)' : ''}
     UNION ALL SELECT id FROM t_icc_telag_staticlogin WHERE ExtNum=? AND IfUse=1 ${config.same_extension ? 'AND NOT (WorkNO=? AND VDNID=?)' : ''}`,
    config.same_extension ? [extension, sourceUserId, actor.vdnId, extension, actor.workNo, actor.vdnId] : [extension, extension]);
  const reserved = await rows(db,
    `SELECT UserID FROM t_icc_agent_video_config WHERE VideoExtension=? AND SameExtension=0 AND NOT (UserID=? AND VDNID=?)`,
    [extension, sourceUserId, actor.vdnId]);
  if (occupied.length || reserved.length) throw new AppError(409, '视频分机已被其他语音或视频身份占用');
}

export async function reservedVideoExtensions(db: Db): Promise<Set<string>> {
  try {
    const reserved = await rows<{ extension: string }>(db,
      "SELECT VideoExtension AS extension FROM t_icc_agent_video_config WHERE SameExtension=0 AND VideoExtension IS NOT NULL AND VideoExtension<>''");
    return new Set(reserved.map(row => row.extension));
  } catch (error) {
    if (missingVideoSchema(error)) return new Set();
    throw error;
  }
}
