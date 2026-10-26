import 'dotenv/config';

export interface EnvConfig {
  NODE_ENV: string;
  PORT: number;
  HOST: string;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_SECRET: string;
  S3_ENDPOINT?: string;
  /** Browser-accessible base URL (defaults to S3_ENDPOINT). Use when API runs in Docker but MinIO is on localhost. */
  S3_PUBLIC_ENDPOINT?: string;
  S3_REGION: string;
  S3_BUCKET?: string;
  S3_ACCESS_KEY?: string;
  S3_SECRET_KEY?: string;
  /** Local disk fallback when S3 is not configured (development) */
  LOCAL_UPLOAD_DIR?: string;
  SMTP_HOST: string;
  SMTP_PORT: number;
  SMTP_USERNAME?: string;
  SMTP_PASSWORD?: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODE?: string;
  OPENAI_BASE_URL?: string;
  OPENAI_MODEL?: string;
  KNOWLEDGE_MODE?: string;
  KNOWLEDGE_BASE_URL?: string;
  KNOWLEDGE_MODEL?: string;
  KNOWLEDGE_API_KEY?: string;
  EMBEDDING_MODE?: string;
  EMBEDDING_BASE_URL?: string;
  EMBEDDING_MODEL?: string;
  EMBEDDING_API_KEY?: string;
  RERANKER_MODE?: string;
  RERANKER_BASE_URL?: string;
  RERANKER_MODEL?: string;
  RERANKER_API_KEY?: string;
  TTS_MODE?: string;
  TTS_BASE_URL?: string;
  TTS_MODEL?: string;
  TTS_API_KEY?: string;
  ASR_MODE?: string;
  ASR_BASE_URL?: string;
  ASR_MODEL?: string;
  ASR_API_KEY?: string;

  ENTERPRISE_MODE: boolean;
  /** CCS AgentObj TARS endpoint, e.g. SMC-ICC.CCSServer.AgentObj@tcp -h master.tars.com -p 9105 */
  CCS_AGENT_OBJ?: string;
  /** ACD ACDObj；未设时由 CCS_AGENT_OBJ 推导 host + 19398 */
  ACD_OBJ?: string;
  OMNI_AGENT_VDN_ID: number;
  OMNI_AGENT_SERVANT_OBJ: string;
  OMNI_AGENT_SERVANT_HOST: string;
  OMNI_AGENT_SERVANT_PORT: number;
  /** Host advertised to CCSServer in AgentPrxEndpoint (use LAN IP in production) */
  OMNI_AGENT_SERVANT_ADVERTISE_HOST: string;
  CCS_WORK_NO_FIELD: string;
  CCS_INVOKE_TIMEOUT_MS: number;
  /**
   * 已废弃：最后一条 WS 断开立刻离开 ACD 排队，不再去抖。
   * 保留字段以免旧 compose 报未知变量；数值忽略。
   */
  CCS_WS_FLASH_MS: number;
  /**
   * WebSocket 全部断开后，延迟多久再 DoAgentLoggedOff（从 disconnect 起算）。
   * 对齐 AGP 常见 30–60s；空闲才注销，通话中延期到挂机。
   */
  CCS_WS_LOGOUT_GRACE_MS: number;
  /**
   * 移动端（client=mobile）专用 LoggedOff grace。
   * 手机切后台/锁屏/被系统回收都会断 WS，按 Web 的 45s 注销会让坐席莫名下线。
   */
  CCS_WS_LOGOUT_GRACE_MOBILE_MS: number;
  /**
   * 移动端断开后「继续留在 ACD 队列」的时长，到期才签出技能组。
   * Web 端是断开即离队（0）；手机需要这段窗口配合推送唤醒，否则切后台就被摘出队列。
   */
  CCS_WS_QUEUE_HOLD_MOBILE_MS: number;
  /** CCS 心跳探测间隔；连续失败后踢全部坐席回登录页 */
  CCS_HEALTH_INTERVAL_MS: number;
  CCS_HEALTH_FAIL_THRESHOLD: number;
  /**
   * 向全部 Socket 广播 CCS 健康快照的间隔（一条 io.emit，与座席数无关）。
   * 0 = 关闭脉冲（仍保留 ccs.down + 连上时推一次）。默认 20s，下限 10s。
   */
  CCS_HEALTH_PULSE_MS: number;
  /** ── 移动坐席 SIP 接入（GET /api/agent/sip-credentials 的下发内容）── */
  /** 对外 SBC 域名/IP；移动 App 只连 SBC，不直连内网 FreeSWITCH */
  SIP_SBC_HOST: string;
  SIP_SBC_PORT: number;
  /** tls | tcp | udp；生产强制 tls */
  SIP_SBC_TRANSPORT: string;
  /** SIP realm / domain，需与 FreeSWITCH directory 的 domain 一致 */
  SIP_REALM: string;
  /** required | optional | disabled */
  SIP_SRTP: string;
  /** 逗号分隔，按优先级；移动端默认 opus,PCMA,PCMU */
  SIP_CODECS: string;
  SIP_REGISTER_EXPIRES_S: number;
  SIP_STUN_SERVER: string;
  SIP_ICE_ENABLED: boolean;
  /** SIP 凭据下发令牌的有效期；App 只在内存持有 */
  SIP_CREDENTIALS_TTL_S: number;
  SIP_WSS_URL: string;
  SIP_ICE_SERVERS_JSON: string;
  VIDEO_CUSTOMER_ENABLED: boolean;
  VIDEO_ENTRIES_JSON: string;
  /** ── 离线推送 ── */
  /** FCM HTTP v1 服务账号 JSON 路径或内联 JSON */
  PUSH_FCM_CREDENTIALS: string;
  PUSH_FCM_PROJECT_ID: string;
  /** APNs token 认证（.p8）；VoIP 推送用 bundle-id.voip 作为 topic */
  PUSH_APNS_KEY: string;
  PUSH_APNS_KEY_ID: string;
  PUSH_APNS_TEAM_ID: string;
  PUSH_APNS_BUNDLE_ID: string;
  PUSH_APNS_PRODUCTION: boolean;
  /** 鸿蒙 Push Kit（AGC OAuth2 client credentials） */
  PUSH_HARMONY_CLIENT_ID: string;
  PUSH_HARMONY_CLIENT_SECRET: string;
  /** Public HTTPS base URL for WeChat/WeCom webhooks */
  PUBLIC_BASE_URL: string;
  /** Shared secret for ConfServer → OmniAgent config sync */
  PLATFORM_SYNC_SECRET?: string;
  /** Email IMAP poll interval; 0 disables background polling */
  EMAIL_INBOX_POLL_INTERVAL_MS: number;
  TIKTOK_APP_ID?: string;
  FACEBOOK_APP_ID?: string;
  RECORDING_SOURCE: string;
  RECORDING_SFTP_HOST: string;
  RECORDING_SFTP_PORT: number;
  RECORDING_SFTP_USER: string;
  RECORDING_SFTP_PASSWORD: string;
  RECORDING_SFTP_ROOT: string;
  /** ICC Integration Hub：默认 0 关闭，零副作用 */
  HUB_ENABLED: boolean;
  HUB_ROLE: string;
  HUB_CONFIG_PATH?: string;
  HUB_SINKS_DISABLED?: string;
  ICC_LEAVEWORD_DIR?: string;
  /** ITRPython HTTP base（TARS 失败时回退；也用于推导 ItrObj host） */
  ITR_HTTP_BASE: string;
  /** SMC-ICC.ITRServer.ItrObj@tcp -h HOST -p 9401；空则从 ITR_HTTP_BASE 推导 */
  ITR_OBJ?: string;
  /** tars | http | auto（默认 auto：TARS 优先，失败回退 HTTP） */
  ITR_TRANSPORT: string;
  /** 辅助观察 WS；空则从 ITR_HTTP_BASE 推导 ws://host:9400/ws/observe */
  ITR_WS_URL?: string;
  /** 默认开；0/false 关闭 Omni→ITR 观察长连接（不改变 TARS/HTTP 业务通道） */
  ITR_WS_ENABLE: boolean;
  ITR_DEFAULT_FLOW_ID: number;
  /** AIQC Python TARS servant endpoint. */
  AIQC_OBJ?: string;
  AIQC_INVOKE_TIMEOUT_MS: number;
  /** Shared secret for AIQCServer task status callbacks. */
  AIQC_CALLBACK_TOKEN?: string;
  /** Auto-submit offline QC when call recording is ready. */
  AIQC_AUTO_SUBMIT: boolean;
  AIQC_AUTO_SUBMIT_POLICY_ID?: string;
  AIQC_RECORDING_URI_PREFIX?: string;
  /** 1 = when ACD unreachable, assign first user (dev) */
  ITR_ACD_FALLBACK_ASSIGN: string;
  /** 1 = widget/渠道进线自动启 ITR */
  ITR_AUTO_START: string;
  /** Omni ACD 回调 Servant（DoRing.CallbackObj） */
  OMNI_ACD_CB_OBJ: string;
  OMNI_ACD_CB_HOST: string;
  OMNI_ACD_CB_PORT: number;
  OMNI_ACD_CB_ADVERTISE_HOST: string;
  /** DoRing 在流程未指定组/技能（-1）时的默认 ACD 目标；测试环境组10/技能10 */
  OMNI_DEFAULT_AGENT_GROUP_ID: number;
  OMNI_DEFAULT_SKILL_ID: number;
  OMNI_ACD_MEDIA_TYPE: number;
  /** 登录后默认全媒体排队模式 EU_AG_MQM（0=ALL） */
  OMNI_ACD_MQM: number;
  /** 含全媒体的接听模式默认接入路数 */
  OMNI_ACD_CALLER_COUNT: number;
  /** CosyVoice2 HTTP TTS（与 TTSServerPy CosyUrl 同一 sidecar） */
  COSYVOICE_TTS_URL: string;
  COSYVOICE_TTS_SPK: string;
  COSYVOICE_TTS_TIMEOUT_MS: number;
  /** 其它 ASR HTTP POST /api/asr {wav_base64}；非空则覆盖 TARS ASRServer */
  FUNASR_ASR_URL: string;
  FUNASR_ASR_TIMEOUT_MS: number;
  /** TARS ASRServer，默认实验室直连 */
  ASR_OBJ: string;
  ASR_INVOKE_TIMEOUT_MS: number;
  ASR_ENGINE: string;
  /** ASRServer 可读取的共享目录（须在 /data /tmp /usr/local/app/tars 下） */
  ASR_CLIP_DIR: string;
}

function required(key: string, fallback?: string): string {
  const value = process.env[key] ?? fallback;
  if (value === undefined) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
}

export const env: EnvConfig = {
  NODE_ENV: process.env.NODE_ENV ?? 'development',
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  HOST: process.env.HOST ?? '0.0.0.0',
  DATABASE_URL: required('DATABASE_URL', 'postgresql://postgres@localhost:5432/chatwoot_dev'),
  REDIS_URL: required('REDIS_URL', 'redis://localhost:6379'),
  JWT_SECRET: required('JWT_SECRET', 'dev-secret-change-me'),
  S3_ENDPOINT: process.env.S3_ENDPOINT,
  S3_PUBLIC_ENDPOINT: process.env.S3_PUBLIC_ENDPOINT,
  S3_REGION: process.env.S3_REGION ?? 'us-east-1',
  S3_BUCKET: process.env.S3_BUCKET,
  S3_ACCESS_KEY: process.env.S3_ACCESS_KEY,
  S3_SECRET_KEY: process.env.S3_SECRET_KEY,
  LOCAL_UPLOAD_DIR: process.env.LOCAL_UPLOAD_DIR,
  SMTP_HOST: process.env.SMTP_HOST ?? 'localhost',
  SMTP_PORT: parseInt(process.env.SMTP_PORT ?? '1025', 10),
  SMTP_USERNAME: process.env.SMTP_USERNAME,
  SMTP_PASSWORD: process.env.SMTP_PASSWORD,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_MODE: process.env.OPENAI_MODE,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  KNOWLEDGE_MODE: process.env.KNOWLEDGE_MODE,
  KNOWLEDGE_BASE_URL: process.env.KNOWLEDGE_BASE_URL,
  KNOWLEDGE_MODEL: process.env.KNOWLEDGE_MODEL,
  KNOWLEDGE_API_KEY: process.env.KNOWLEDGE_API_KEY,
  EMBEDDING_MODE: process.env.EMBEDDING_MODE,
  EMBEDDING_BASE_URL: process.env.EMBEDDING_BASE_URL,
  EMBEDDING_MODEL: process.env.EMBEDDING_MODEL,
  EMBEDDING_API_KEY: process.env.EMBEDDING_API_KEY,
  RERANKER_MODE: process.env.RERANKER_MODE,
  RERANKER_BASE_URL: process.env.RERANKER_BASE_URL,
  RERANKER_MODEL: process.env.RERANKER_MODEL,
  RERANKER_API_KEY: process.env.RERANKER_API_KEY,
  TTS_MODE: process.env.TTS_MODE,
  TTS_BASE_URL: process.env.TTS_BASE_URL,
  TTS_MODEL: process.env.TTS_MODEL,
  TTS_API_KEY: process.env.TTS_API_KEY,
  ASR_MODE: process.env.ASR_MODE,
  ASR_BASE_URL: process.env.ASR_BASE_URL,
  ASR_MODEL: process.env.ASR_MODEL,
  ASR_API_KEY: process.env.ASR_API_KEY,

  ENTERPRISE_MODE: process.env.ENTERPRISE_MODE === 'true',
  CCS_AGENT_OBJ: process.env.CCS_AGENT_OBJ,
  ACD_OBJ: process.env.ACD_OBJ,
  OMNI_AGENT_VDN_ID: parseInt(process.env.OMNI_AGENT_VDN_ID ?? '1', 10),
  OMNI_AGENT_SERVANT_OBJ: process.env.OMNI_AGENT_SERVANT_OBJ ?? 'SMC-ICC.OmniAgent.AgentObj',
  OMNI_AGENT_SERVANT_HOST: process.env.OMNI_AGENT_SERVANT_HOST ?? '0.0.0.0',
  OMNI_AGENT_SERVANT_PORT: parseInt(process.env.OMNI_AGENT_SERVANT_PORT ?? '9105', 10),
  OMNI_AGENT_SERVANT_ADVERTISE_HOST: process.env.OMNI_AGENT_SERVANT_ADVERTISE_HOST ?? 'master.tars.com',
  CCS_WORK_NO_FIELD: process.env.CCS_WORK_NO_FIELD ?? 'uid',
  CCS_INVOKE_TIMEOUT_MS: parseInt(process.env.CCS_INVOKE_TIMEOUT_MS ?? '30000', 10),
  CCS_WS_FLASH_MS: parseInt(process.env.CCS_WS_FLASH_MS ?? '0', 10),
  CCS_WS_LOGOUT_GRACE_MS: parseInt(process.env.CCS_WS_LOGOUT_GRACE_MS ?? '45000', 10),
  CCS_WS_LOGOUT_GRACE_MOBILE_MS: parseInt(process.env.CCS_WS_LOGOUT_GRACE_MOBILE_MS ?? '300000', 10),
  CCS_WS_QUEUE_HOLD_MOBILE_MS: parseInt(process.env.CCS_WS_QUEUE_HOLD_MOBILE_MS ?? '60000', 10),
  CCS_HEALTH_INTERVAL_MS: parseInt(process.env.CCS_HEALTH_INTERVAL_MS ?? '3000', 10),
  CCS_HEALTH_FAIL_THRESHOLD: parseInt(process.env.CCS_HEALTH_FAIL_THRESHOLD ?? '2', 10),
  CCS_HEALTH_PULSE_MS: parseInt(process.env.CCS_HEALTH_PULSE_MS ?? '20000', 10),
  SIP_SBC_HOST: process.env.SIP_SBC_HOST ?? '',
  SIP_SBC_PORT: parseInt(process.env.SIP_SBC_PORT ?? '5061', 10),
  SIP_SBC_TRANSPORT: (process.env.SIP_SBC_TRANSPORT ?? 'tls').toLowerCase(),
  SIP_REALM: process.env.SIP_REALM ?? '',
  SIP_SRTP: (process.env.SIP_SRTP ?? 'required').toLowerCase(),
  SIP_CODECS: process.env.SIP_CODECS ?? 'opus,PCMA,PCMU',
  SIP_REGISTER_EXPIRES_S: parseInt(process.env.SIP_REGISTER_EXPIRES_S ?? '300', 10),
  SIP_STUN_SERVER: process.env.SIP_STUN_SERVER ?? '',
  SIP_ICE_ENABLED: /^(1|true|yes)$/i.test(process.env.SIP_ICE_ENABLED ?? '0'),
  SIP_CREDENTIALS_TTL_S: parseInt(process.env.SIP_CREDENTIALS_TTL_S ?? '3600', 10),
  SIP_WSS_URL: process.env.SIP_WSS_URL ?? '',
  SIP_ICE_SERVERS_JSON: process.env.SIP_ICE_SERVERS_JSON ?? '[]',
  VIDEO_CUSTOMER_ENABLED: process.env.VIDEO_CUSTOMER_ENABLED === '1',
  VIDEO_ENTRIES_JSON: process.env.VIDEO_ENTRIES_JSON ?? '[]',
  PUSH_FCM_CREDENTIALS: process.env.PUSH_FCM_CREDENTIALS ?? '',
  PUSH_FCM_PROJECT_ID: process.env.PUSH_FCM_PROJECT_ID ?? '',
  PUSH_APNS_KEY: process.env.PUSH_APNS_KEY ?? '',
  PUSH_APNS_KEY_ID: process.env.PUSH_APNS_KEY_ID ?? '',
  PUSH_APNS_TEAM_ID: process.env.PUSH_APNS_TEAM_ID ?? '',
  PUSH_APNS_BUNDLE_ID: process.env.PUSH_APNS_BUNDLE_ID ?? '',
  PUSH_APNS_PRODUCTION: /^(1|true|yes)$/i.test(process.env.PUSH_APNS_PRODUCTION ?? '0'),
  PUSH_HARMONY_CLIENT_ID: process.env.PUSH_HARMONY_CLIENT_ID ?? '',
  PUSH_HARMONY_CLIENT_SECRET: process.env.PUSH_HARMONY_CLIENT_SECRET ?? '',
  PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL ?? `http://localhost:${parseInt(process.env.PORT ?? '3000', 10)}`,
  PLATFORM_SYNC_SECRET: process.env.PLATFORM_SYNC_SECRET || process.env.OMNIAGENT_SYNC_TOKEN,
  /** Email IMAP poll interval; 0 disables background polling */
  EMAIL_INBOX_POLL_INTERVAL_MS: parseInt(process.env.EMAIL_INBOX_POLL_INTERVAL_MS ?? '120000', 10),
  TIKTOK_APP_ID: process.env.TIKTOK_APP_ID,
  FACEBOOK_APP_ID: process.env.FACEBOOK_APP_ID,
  RECORDING_SOURCE: process.env.RECORDING_SOURCE ?? 'sftp',
  RECORDING_SFTP_HOST: process.env.RECORDING_SFTP_HOST ?? '192.168.255.128',
  RECORDING_SFTP_PORT: parseInt(process.env.RECORDING_SFTP_PORT ?? '22', 10),
  RECORDING_SFTP_USER: process.env.RECORDING_SFTP_USER ?? 'root',
  RECORDING_SFTP_PASSWORD: process.env.RECORDING_SFTP_PASSWORD ?? '',
  RECORDING_SFTP_ROOT:
    process.env.RECORDING_SFTP_ROOT
    ?? '/usr/local/freeswitch-1.10.12/var/lib/freeswitch/recordings',
  HUB_ENABLED: process.env.HUB_ENABLED === '1' || process.env.HUB_ENABLED === 'true',
  HUB_ROLE: process.env.HUB_ROLE ?? 'inline',
  HUB_CONFIG_PATH: process.env.HUB_CONFIG_PATH,
  HUB_SINKS_DISABLED: process.env.HUB_SINKS_DISABLED,
  ICC_LEAVEWORD_DIR: process.env.ICC_LEAVEWORD_DIR,
  ITR_HTTP_BASE: process.env.ITR_HTTP_BASE ?? 'http://127.0.0.1:9400',
  ITR_OBJ: process.env.ITR_OBJ,
  ITR_TRANSPORT: process.env.ITR_TRANSPORT ?? 'auto',
  ITR_WS_URL: process.env.ITR_WS_URL,
  ITR_WS_ENABLE: (() => {
    const raw = (process.env.ITR_WS_ENABLE ?? '').trim().toLowerCase();
    if (raw) return !['0', 'false', 'no'].includes(raw);
    return process.env.NODE_ENV !== 'test';
  })(),
  ITR_DEFAULT_FLOW_ID: parseInt(process.env.ITR_DEFAULT_FLOW_ID ?? '1001', 10),
  AIQC_OBJ: process.env.AIQC_OBJ,
  AIQC_INVOKE_TIMEOUT_MS: parseInt(process.env.AIQC_INVOKE_TIMEOUT_MS ?? '10000', 10),
  AIQC_CALLBACK_TOKEN: process.env.AIQC_CALLBACK_TOKEN,
  AIQC_AUTO_SUBMIT: process.env.AIQC_AUTO_SUBMIT === '1' || process.env.AIQC_AUTO_SUBMIT === 'true',
  AIQC_AUTO_SUBMIT_POLICY_ID: process.env.AIQC_AUTO_SUBMIT_POLICY_ID,
  AIQC_RECORDING_URI_PREFIX: process.env.AIQC_RECORDING_URI_PREFIX,
  ITR_ACD_FALLBACK_ASSIGN: process.env.ITR_ACD_FALLBACK_ASSIGN ?? '1',
  ITR_AUTO_START: process.env.ITR_AUTO_START ?? '1',
  OMNI_ACD_CB_OBJ: process.env.OMNI_ACD_CB_OBJ ?? 'SMC-ICC.OmniAgent.AcdCbObj',
  OMNI_ACD_CB_HOST: process.env.OMNI_ACD_CB_HOST ?? '0.0.0.0',
  OMNI_ACD_CB_PORT: parseInt(process.env.OMNI_ACD_CB_PORT ?? '9106', 10),
  OMNI_ACD_CB_ADVERTISE_HOST:
    process.env.OMNI_ACD_CB_ADVERTISE_HOST
    ?? process.env.OMNI_AGENT_SERVANT_ADVERTISE_HOST
    ?? 'master.tars.com',
  OMNI_DEFAULT_AGENT_GROUP_ID: parseInt(process.env.OMNI_DEFAULT_AGENT_GROUP_ID ?? '12', 10),
  OMNI_DEFAULT_SKILL_ID: parseInt(process.env.OMNI_DEFAULT_SKILL_ID ?? '12', 10),
  OMNI_ACD_MEDIA_TYPE: parseInt(process.env.OMNI_ACD_MEDIA_TYPE ?? '1', 10),
  OMNI_ACD_MQM: parseInt(process.env.OMNI_ACD_MQM ?? '0', 10),
  OMNI_ACD_CALLER_COUNT: parseInt(process.env.OMNI_ACD_CALLER_COUNT ?? '10', 10),
  COSYVOICE_TTS_URL: process.env.COSYVOICE_TTS_URL ?? 'http://172.22.0.13:50000/tts',
  COSYVOICE_TTS_SPK: process.env.COSYVOICE_TTS_SPK ?? 'voice_a',
  COSYVOICE_TTS_TIMEOUT_MS: parseInt(process.env.COSYVOICE_TTS_TIMEOUT_MS ?? '60000', 10),
  FUNASR_ASR_URL: process.env.FUNASR_ASR_URL ?? '',
  FUNASR_ASR_TIMEOUT_MS: parseInt(process.env.FUNASR_ASR_TIMEOUT_MS ?? '20000', 10),
  ASR_OBJ:
    process.env.ASR_OBJ
    ?? 'SMC-ICC.ASRServer.asrObj@tcp -h 172.22.0.4 -p 19399 -t 60000',
  ASR_INVOKE_TIMEOUT_MS: parseInt(process.env.ASR_INVOKE_TIMEOUT_MS ?? '60000', 10),
  ASR_ENGINE: process.env.ASR_ENGINE ?? 'funasr',
  ASR_CLIP_DIR: process.env.ASR_CLIP_DIR ?? '/data/tars/omni-asr',
};
