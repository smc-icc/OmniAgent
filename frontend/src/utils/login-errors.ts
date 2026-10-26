/**
 * 登录失败文案：全媒体（Chatwoot/Omni）官方原因 + CCS Focus 官方原因。
 * 对坐席展示时带「全媒体：」「话务：」前缀，避免两段登录混成一句「登录失败」。
 */

/** CCS Focus ccserrcode.h / AgentLoginHandler 登录相关 Result */
const CCS_LOGIN_REASONS: Record<number, string> = {
  // AgentLoginHandler 本地码
  [-1]: '登录请求无效',
  [-2]: '工号不能为空',
  [-3]: '分机号不能为空',
  [-5]: '重复登录',
  [-90]: '坐席不在本 CCS 节点',
  // CCS_ERR_*（CCS_ERR_BASE=1000）
  1004: '超时',
  1005: 'CCS未就绪',
  1017: '查数据库失败',
  1021: 'ACD无效，请检查ACD服务是否已经正常运行',
  1028: 'CCS请求其他资源时发生网络故障',
  1039: 'TAS无效，请检查TAS服务是否已经正常运行',
  1042: 'CCS未就绪',
  1043: 'CCS内部错误',
  1044: 'CCS请求其他资源或操作失败',
  1045: 'CCS请求其他资源时发生网络故障',
  1048: '坐席无效或未被加载',
  1050: '重复登录',
  1051: '还没有登录',
  1052: '增加Agent失败',
  1053: '坐席已存在',
  1055: '坐席话务忙，无法强制下线',
  1056: 'Agent权限不足',
  1061: '坐席未登录',
  1118: '分机号错误',
  1119: '工号或密码错误',
  1127: '分机号冲突',
  1136: '坐席不属于任何技能组',
}

/** 全媒体 /auth/sign_in（对齐 Chatwoot zh_CN login.json） */
const OMNI_UNAUTH = '用户名或密码不正确，请重试。'
const OMNI_UNREACHABLE = '无法连接全媒体服务，请稍后再试'
const OMNI_EMAIL = '请输入一个有效的电子邮件'
const OMNI_PASSWORD = '请输入密码'
const OMNI_EXTENSION = '请输入分机号'

export function ccsLoginReason(result: number, errMsg?: string): string {
  const mapped = CCS_LOGIN_REASONS[result]
  if (mapped) return mapped
  const extra = (errMsg ?? '').trim()
  if (extra) return extra
  return `登录失败（${result}）`
}

export function formatCcsLoginError(result: number, errMsg?: string): string {
  return `话务：${ccsLoginReason(result, errMsg)}`
}

export function formatCcsLoginTransportError(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/socket not connected/i.test(raw)) return '话务：坐席通道未连接'
  if (/timeout/i.test(raw)) return '话务：登录超时'
  if (raw.trim()) return `话务：${raw.trim()}`
  return '话务：登录失败'
}

export function omniLoginReason(err: unknown): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const ax = err as {
      response?: { status?: number; data?: { error?: string; errors?: string[]; error_code?: string } }
      code?: string
      message?: string
    }
    const status = ax.response?.status
    const body = ax.response?.data
    const apiErr = String(body?.error ?? '')
    const details = (body?.errors ?? []).join(' ')

    if (status === 401 || /invalid email or password|unauthorized/i.test(apiErr)) {
      return OMNI_UNAUTH
    }
    if (status === 422 || /invalid email|email format/i.test(`${apiErr} ${details}`)) {
      if (/password/i.test(`${apiErr} ${details}`) && !/email/i.test(`${apiErr} ${details}`)) {
        return OMNI_PASSWORD
      }
      return OMNI_EMAIL
    }
    if (!ax.response || ax.code === 'ECONNABORTED' || ax.code === 'ERR_NETWORK') {
      return OMNI_UNREACHABLE
    }
    if (apiErr.trim()) return apiErr.trim()
  }
  const raw = err instanceof Error ? err.message : String(err ?? '')
  if (/invalid email or password/i.test(raw)) return OMNI_UNAUTH
  if (/invalid email/i.test(raw)) return OMNI_EMAIL
  if (!raw.trim() || /network|timeout|econn/i.test(raw)) return OMNI_UNREACHABLE
  return raw.trim()
}

export function formatOmniLoginError(err: unknown): string {
  return `全媒体：${omniLoginReason(err)}`
}

/** 只有账号或密码本身错误时才清空密码框。话务启动失败等仍保留已输入的密码。 */
export function isCredentialLoginError(message: string): boolean {
  return /用户名或密码不正确|工号或密码错误|账号或密码错误|帐号或密码错误/.test(message)
}

export function formatOmniLoginEmptyToken(): string {
  return `全媒体：${OMNI_UNREACHABLE}`
}

export function formatOmniLoginMissingExtension(): string {
  return `全媒体：${OMNI_EXTENSION}`
}
