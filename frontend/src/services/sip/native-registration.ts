import type { SipEventPayloads, SipRegistrationState, SipUnsubscribe } from './SipEngine'

type RegistrationEvent = SipEventPayloads['registrationChanged']
interface NativeRegistrationPorts {
  subscribe(handler: (event: RegistrationEvent) => void): SipUnsubscribe | Promise<SipUnsubscribe>
  send(registrationId: string): unknown | Promise<unknown>
  stop(registrationId: string): unknown | Promise<unknown>
  state(state: SipRegistrationState): void
}
let sequence = 0

/** Native command acknowledgement is separate from the SIP registrar response. */
export class NativeSipRegistration {
  private tail: Promise<unknown> = Promise.resolve()
  private cancelCurrent: (() => void) | null = null
  private currentId = ''
  private generation = 0
  private cleanupFailure: Error | null = null

  accepts(event: RegistrationEvent): boolean {
    return !!this.currentId && event.registrationId === this.currentId
  }

  cancel(): void { this.generation++; this.cancelCurrent?.() }

  register(ports: NativeRegistrationPorts): Promise<void> {
    this.cancel()
    const generation = this.generation
    const operation = this.tail.then(() => {
      if (generation !== this.generation) throw new Error('SIP 注册已取消')
      if (this.cleanupFailure) throw this.cleanupFailure
      return this.execute(ports)
    })
    this.tail = operation.catch(() => undefined)
    return operation
  }

  async unregister(stop: () => unknown | Promise<unknown>): Promise<void> {
    this.cancel()
    this.currentId = ''
    const operation = this.tail.then(async () => {
      await this.cleanup(stop)
      this.cleanupFailure = null
    })
    this.tail = operation.catch(() => undefined)
    await operation
  }

  private async cleanup(stop: () => unknown | Promise<unknown>): Promise<void> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.resolve().then(stop),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('原生清理超时')), 5_000) }),
      ])
    } catch {
      this.cleanupFailure = new Error('SIP 注册清理失败，请退出登录后重试')
      throw this.cleanupFailure
    } finally { if (timer != null) clearTimeout(timer) }
  }

  private async execute(ports: NativeRegistrationPorts): Promise<void> {
    const id = 'sip-' + Date.now() + '-' + ++sequence
    this.currentId = id
    ports.state('registering')
    let settled = false
    let accepted = false
    let registered = false
    let sent = false
    const subscription: { off?: SipUnsubscribe } = {}
    let resolveResult!: () => void
    let rejectResult!: (error: Error) => void
    const result = new Promise<void>((resolve, reject) => { resolveResult = resolve; rejectResult = reject })
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      error ? rejectResult(error) : resolveResult()
    }
    const cancel = () => finish(new Error('SIP 注册已取消'))
    this.cancelCurrent = cancel
    const timer = setTimeout(() => finish(new Error('SIP 注册超时，请检查网络后重试')), 30_000)
    const event = (payload: RegistrationEvent) => {
      if (settled || !this.accepts(payload)) return
      if (payload.state === 'registered' && payload.code != null && payload.code >= 200 && payload.code < 300) {
        registered = true
        if (accepted) finish()
      } else if (payload.state === 'failed' || payload.state === 'unregistered') {
        finish(new Error('SIP 注册失败' + (payload.code ? '（' + payload.code + '）' : '') + (payload.reason ? '：' + payload.reason : '')))
      }
    }
    // Subscribe before sending: a fast native response must never be missed.
    void Promise.resolve().then(() => ports.subscribe(event)).then(unsubscribe => {
      subscription.off = unsubscribe
      if (settled) { unsubscribe(); subscription.off = undefined; return }
      sent = true
      return Promise.resolve(ports.send(id)).then(() => {
        accepted = true
        if (registered) finish()
      })
    }).catch(error => finish(new Error(error && typeof error.message === 'string' ? error.message : 'SIP 原生注册调用失败')))
    try {
      await result
      ports.state('registered')
    } catch (error) {
      ports.state('failed')
      this.currentId = ''
      clearTimeout(timer)
      subscription.off?.()
      subscription.off = undefined
      if (sent) await this.cleanup(() => ports.stop(id))
      throw error
    } finally {
      clearTimeout(timer)
      subscription.off?.()
      if (this.cancelCurrent === cancel) this.cancelCurrent = null
    }
  }
}
