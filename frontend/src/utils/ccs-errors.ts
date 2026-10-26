/**
 * CCS / TAS Ack.Status → 坐席可见文案。
 * 对照 Focus `dalmanager.cpp` CtiError 表 + `ccserrcode.h`（CCS_ERR_BASE=1000）。
 * 1056 / 1115 对坐席展示「无权限」，不回显数字码。
 */

const CCS_ERR: Record<number, string> = {
  [-1]: '请求无效',
  [-2]: '目标坐席不存在',
  [-3]: '没有空闲通道',
  [-4]: '坐席不存在',
  [-5]: '坐席不存在',
  [-6]: '目标坐席未登录',
  [-7]: '不能抢接自己',
  [-90]: '坐席不在本 CCS 节点',
  [-1072]: '上次动作未完成',

  1001: '没有基础通道配置',
  1002: '已经注册',
  1003: '应用不存在',
  1004: '超时',
  1005: 'CCS未就绪',
  1006: 'CCS未加载该通道',
  1007: '被叫外线忙音',
  1008: '被叫外线无应答',
  1009: '被叫外线无回铃声',
  1010: '被叫外线无拨号音',
  1011: '被叫外线是传真',
  1012: '外呼失败',
  1013: '通道范围错误',
  1014: 'MYID错误',
  1015: '通道状态错误',
  1016: '没有路由组名',
  1017: '查数据库失败',
  1018: '查数据库记录为空',
  1019: '没有路由',
  1020: '建立单边呼叫失败',
  1021: 'ACD无效，请检查ACD服务是否已经正常运行',
  1022: '关联应用程序失败',
  1023: '发消息失败',
  1024: '应用类型错误',
  1026: 'CCS内部错误',
  1027: 'CCS请求其他资源或操作失败',
  1028: 'CCS网络故障',
  1029: '应用无效或未被加载',
  1030: '应用未就绪',
  1031: '通道无效',
  1032: '通道当前状态不正确',
  1033: '应用程序无效',
  1034: '状态不匹配',
  1035: '呼叫无效',
  1036: '呼叫类型错误',
  1037: '呼叫通道不匹配',
  1038: '不是主会议通道',
  1039: 'TAS无效，请检查TAS服务是否已经正常运行',
  1040: '请求会议通道失败',
  1041: '坐席模块错误',
  1042: 'CCS未就绪',
  1043: 'CCS内部错误',
  1044: 'CCS请求其他资源或操作失败',
  1045: 'CCS网络故障',
  1046: '应用无效或未被加载',
  1047: '应用未就绪',
  1048: '坐席无效或未被加载',
  1049: '坐席当前状态不正确',
  1050: '重复登录',
  1051: '还没有登录',
  1052: '增加坐席失败',
  1053: '坐席已经存在',
  1054: '技能类型错误',
  1055: '坐席状态错误',
  1056: '无权限',
  1057: '摘机失败',
  1058: '还有其它动作未完成',
  1059: '会话非空',
  1060: '未知呼转类型',
  1061: '坐席未登录',
  1062: '被叫坐席动作不为空闲',
  1063: '被叫坐席忙',
  1064: '呼叫失败',
  1065: '被叫坐席已退出',
  1066: '坐席会话不为空闲，可能正在被监听或强插中',
  1067: '通话已经结束或还没有建立',
  1068: '创建呼叫失败',
  1069: '主叫方挂机',
  1070: '加入会议失败',
  1071: '被对方拒绝',
  1072: '上次动作未完成',
  1073: '会议太大',
  1074: '创建会议失败',
  1075: '坐席会话错误',
  1076: '保持失败',
  1078: '连接错误',
  1079: '坐席挂机',
  1080: '客户已挂机',
  1081: '不是会议会话',
  1082: '会议人数不够',
  1083: '客户可能已经挂断',
  1084: '坐席应用无效',
  1085: '呼转类型错误',
  1086: '第三方呼叫类型错误',
  1087: '主动作错误',
  1088: '坐席ID不匹配',
  1089: '被踢人数大于会议大小',
  1090: '被踢人数为0',
  1091: '没有可踢出的会议方',
  1092: '清除呼叫失败',
  1093: '不能保持被强插的会话',
  1094: '没有客户可以保持',
  1095: '开会时不能保持',
  1096: '保持客户失败',
  1097: '保持坐席失败',
  1098: '逻辑通号错误',
  1099: '呼叫角色错误',
  1100: '呼叫忙',
  1101: '从动作错误',
  1102: '没有等待客户',
  1103: '呼叫错误',
  1104: '参数错误',
  1105: '会话忙',
  1106: '没有保持的呼叫',
  1107: '目标坐席不存在',
  1108: '已经示忙',
  1109: '已经示闲',
  1110: '会话类型错误',
  1111: '通道已挂机',
  1112: '工号错误',
  1113: '技能ID错误',
  1114: '坐席组ID错误',
  1115: '无权限',
  1116: '主叫不存在',
  1117: '坐席忙',
  1118: '分机号错误',
  1119: '坐席认证失败',
  1120: 'license状态错误',
  1121: 'license不足',
  1122: '坐席转坐席失败',
  1123: '转坐席被拒绝',
  1124: '坐席转移被抢回',
  1125: '监控坐席不存在',
  1126: '没有可用通道',
  1127: '分机号冲突',
  1128: '会话不存在',
  1129: '没有空闲通道',
  1130: '优先级太低',
  1131: '坐席邀请失败',
  1132: '坐席邀请被拒绝',
  1133: '坐席邀请无应答',
  1134: '坐席VDN错误',
  1135: '数据库类型错误',
  1136: '坐席不属于任何组',
  1137: '无效VDNID',
  1138: '无效VDN',
  1139: '坐席未签入任何坐席组',
  1140: '坐席未签入任何技能',
  1999: 'CCS未知错误',

  2000: '通道已经使用',
  2007: '通道不存在',
  2008: '通道状态不匹配',
  2009: '通道动作不匹配',
  2014: '通道忙',
  2016: '通道连接失败',
  2019: '播放文件失败',
  2021: '开始录音失败',
  2024: '会议ID已存在',
  2025: '会议不存在',
  2029: '创建会议失败',
  2036: '呼叫失败',
  2040: '加入会议失败',
  2041: '退出会议失败',
  2042: '会议已满',
  2060: '改变会议模式失败',
  2066: '外呼Sip帐号未注册',
  2701: 'Sip分机不存在',
  2702: 'Sip分机未注册',
  2703: 'Sip分机忙',
  2999: 'TAS未知错误',
}

function lookupCcsText(code: number): string | undefined {
  const n = Math.trunc(Number(code) || 0)
  if (n === 0) return undefined
  return CCS_ERR[n] ?? (n < 0 ? CCS_ERR[-n] : undefined)
}

/** 从「失败(1115)」「分配失败(1115)」「1115」里抽出 CCS 码。 */
export function extractCcsCode(text: string | undefined | null): number | undefined {
  const msg = (text ?? '').trim()
  if (!msg) return undefined
  if (/^-?\d+$/.test(msg)) {
    const n = Number(msg)
    return Number.isFinite(n) && n !== 0 ? n : undefined
  }
  const m = msg.match(/(?:失败|错误|Result|Status|code|err)[=:：\s（(]*(-?\d{3,4})\s*[)）]?/i)
    ?? msg.match(/[（(]\s*(-?\d{3,4})\s*[)）]/)
  if (!m) return undefined
  const n = Number(m[1])
  return Number.isFinite(n) && n !== 0 ? n : undefined
}

function isRawCcsNoise(msg: string): boolean {
  if (/^\d+$/.test(msg)) return true
  if (/^(失败|操作失败|分配失败|抢接失败|呼叫坐席失败|坐席播放失败)\(\s*-?\d+\s*\)$/.test(msg)) return true
  if (/^(no |invalid |failed|dst |agent |call |not )/i.test(msg)) return true
  if (/power/i.test(msg)) return true
  return false
}

function pickNumericCode(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v) && v !== 0 && !Array.isArray(v)) return Math.trunc(v)
  if (typeof v === 'string' && /^-?\d+$/.test(v.trim())) {
    const n = Number(v)
    if (n !== 0) return Math.trunc(n)
  }
  return undefined
}

/** Ack.Status / Result / err → CCS 错误码（0=成功）。优先非 0 的 Result/Status。 */
export function ccsAckCode(ack: Record<string, unknown> | null | undefined): number {
  if (!ack) return 0
  const nested = ack.Base && typeof ack.Base === 'object' ? (ack.Base as Record<string, unknown>) : undefined
  for (const v of [ack.Result, ack.Status, ack.err, ack.errCode, nested?.Status, nested?.Result]) {
    if (Array.isArray(v)) continue
    const n = pickNumericCode(v)
    if (n != null) return n
  }
  const msg = typeof ack.errMsg === 'string' ? ack.errMsg : ''
  return extractCcsCode(msg) ?? 0
}

/** CCS / TAS 错误码 → 中文。已映射的码不回显数字。 */
export function formatCcsError(code: number, errMsg?: string): string {
  const extra = (errMsg ?? '').trim()
  const fromText = extractCcsCode(extra)
  const n = Math.trunc(Number(code) || 0) || fromText || 0
  if (/no\s+\w+\s+power/i.test(extra) || /权限不足|无权限/.test(extra)) {
    const mappedPower = lookupCcsText(n)
    return mappedPower || '无权限'
  }
  const mapped = lookupCcsText(n)
  if (mapped) return mapped
  if (extra && !isRawCcsNoise(extra)) return extra
  if (n !== 0) return `操作失败（${n}）`
  return extra && !isRawCcsNoise(extra) ? extra : ''
}

export function formatCcsAck(ack: Record<string, unknown> | null | undefined): string {
  if (!ack) return '操作失败'
  const rc = ccsAckCode(ack)
  const msg = typeof ack.errMsg === 'string' ? ack.errMsg : ''
  return formatCcsError(rc, msg) || '操作失败'
}

/** HTTP / catch 里的 Error、Axios 502 `{ error, code }` → 中文。 */
export function formatCcsThrown(err: unknown, fallback = '操作失败'): string {
  if (err && typeof err === 'object' && 'response' in err) {
    const data = (err as { response?: { data?: { error?: string; code?: number } } }).response?.data
    const code = Number(data?.code ?? 0)
    const text = typeof data?.error === 'string' ? data.error : ''
    if (code || text) return formatCcsError(code, text) || fallback
  }
  const msg = err instanceof Error ? err.message : String(err ?? '')
  return formatCcsError(0, msg) || fallback
}
