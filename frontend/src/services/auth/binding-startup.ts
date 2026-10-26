export interface StartupBinding {
  extension: string
  version: number
  conflict?: string | null
}
export interface BindingStartupPorts {
  readBinding(): Promise<StartupBinding>
  startSocket(): Promise<unknown>
  registerSip?(): Promise<unknown>
  signInVoice(version: number): Promise<unknown>
  clearVoice(): void | Promise<void>
}
export async function startBoundVoice(ports: BindingStartupPorts): Promise<void> {
  const binding = await ports.readBinding()
  if (binding.conflict) throw new Error(binding.conflict)
  if (!binding.extension) {
    await ports.clearVoice()
    await ports.startSocket()
    return
  }
  await ports.startSocket()
  await ports.registerSip?.()
  await ports.signInVoice(binding.version)
}

export function voiceStartupError(error: unknown): string {
  const e = (error && typeof error === 'object' ? error : {}) as {
    code?: string
    message?: string
    response?: { data?: { error?: unknown } }
  }
  const reason = e.response?.data?.error
  if (typeof reason === 'string' && reason.trim()) return reason.slice(0, 500)
  if (e.code === 'ECONNABORTED' || e.code === 'ETIMEDOUT') return '话务启动超时，请重试'
  if (e.code === 'ERR_NETWORK') return '无法连接话务服务，请检查网络后重试'
  return e.message || '话务启动失败，请重试'
}
