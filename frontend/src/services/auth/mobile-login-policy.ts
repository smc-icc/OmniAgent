export function mobileLoginLayout(shell: string, width: number): boolean {
  if (shell === 'tauri') return false
  return shell === 'capacitor' || shell === 'harmonyos' || width <= 768
}
export function identityOnlySession(method: string, hadVoice: boolean, serverExpectsVoice = false): boolean {
  return (method === 'social' || method === 'authorization_code' || method === 'sms') && !hadVoice && !serverExpectsVoice
}

export function authorizationCodeLoginError(error: unknown): string {
  const failure = (error && typeof error === 'object' ? error : {}) as { response?: { status?: number }; code?: string }
  switch (failure.response?.status) {
    case 401: return '授权码无效、已使用或已过期，请联系本 VDN 管理员重新获取'
    case 422: return '请输入管理员签发的完整授权码'
    case 429: return '尝试过于频繁，请稍后重试'
    case 503: return '授权码登录暂不可用，请使用账号密码登录'
  }
  return failure.response ? '授权码登录失败，请稍后重试' : '无法连接登录服务，请检查网络后重试'
}
