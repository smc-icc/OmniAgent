import { getSocket, notifyUiBackground, notifyUiForeground } from '@/services/socket'
import { onHarmonyEvent } from '@/services/sip/harmony-bridge'
import { isMobileClient } from '@/utils/platform'

/**
 * App 前后台切换的统一处理。
 *
 * 后台：只发 ccs.ui.background，坐席继续留在 ACD 队列，来电由后端改走推送唤醒。
 * 前台：等 Socket 重连（后端会 flush 期间缓冲的 ccs.agent 事件），然后统一 hydrate
 *       会话状态与列表，避免界面停留在切后台前的旧快照。
 */

type Unsub = () => void

const HYDRATE_EVENT = 'omni:mobile-hydrate'
/** Socket 重连的最长等待时间；超时也要 hydrate，宁可数据稍旧也不能白屏 */
const SOCKET_WAIT_MS = 8000

let unsubs: Unsub[] = []
let hydrating: Promise<void> | null = null
let lastBackgroundAt = 0

/** 视图可订阅此事件，在 App 回到前台时刷新自己的列表 */
export function onMobileHydrate(handler: () => void): Unsub {
  const listener = () => handler()
  window.addEventListener(HYDRATE_EVENT, listener)
  return () => window.removeEventListener(HYDRATE_EVENT, listener)
}

function waitForSocket(): Promise<void> {
  const socket = getSocket()
  if (!socket) return Promise.resolve()
  if (socket.connected) return Promise.resolve()
  // 系统可能在后台已经断开了长连接，主动触发一次重连而不是干等
  socket.connect()
  return new Promise<void>((resolve) => {
    const timer = setTimeout(finish, SOCKET_WAIT_MS)
    function finish() {
      clearTimeout(timer)
      socket!.off('connect', finish)
      resolve()
    }
    socket.once('connect', finish)
  })
}

/**
 * 后台期间系统可能已经杀掉注册续期，或原生侧还挂着一通我们不知道的呼叫。
 * 回前台时把两者对齐：先补注册，再把原生活动呼叫回填进双腿关联表。
 */
async function syncNativeCallState(signedIn: boolean) {
  const [{ getSipEngine }, { resyncCalls }, { ensureSipRegistered }] = await Promise.all([
    import('@/services/sip'),
    import('@/services/sip/call-coordinator'),
    import('@/services/sip/registration'),
  ])
  if (!getSipEngine().available) return
  await resyncCalls().catch(() => undefined)
  if (signedIn) await ensureSipRegistered().catch(() => undefined)
}

/**
 * 恢复前台的 hydrate：CCS 会话 + 坐席状态（agent.hydrate 内部两个接口）+ 会话列表。
 * 并发调用合并成一次，避免连续的 resume 事件打出多轮请求。
 */
export async function hydrateOnForeground(): Promise<void> {
  if (hydrating) return hydrating
  hydrating = (async () => {
    try {
      await waitForSocket()
      const [{ useAgentStore }, { useMobileSessionsStore }] = await Promise.all([
        import('@/stores/agent'),
        import('@/stores/mobileSessions'),
      ])
      const agent = useAgentStore()
      // agent.hydrate() = GET /api/agent/ccs-session + GET /api/agent/status
      await Promise.allSettled([
        agent.hydrate(),
        useMobileSessionsStore().refresh({ silent: true }),
        syncNativeCallState(Boolean(agent.agentId)),
      ])
      window.dispatchEvent(new CustomEvent(HYDRATE_EVENT))
    } finally {
      hydrating = null
    }
  })()
  return hydrating
}

function enterBackground() {
  lastBackgroundAt = Date.now()
  notifyUiBackground()
}

function enterForeground() {
  notifyUiForeground()
  // 一两秒的瞬时切换不值得打一轮请求
  if (lastBackgroundAt && Date.now() - lastBackgroundAt < 2000) return
  lastBackgroundAt = 0
  void hydrateOnForeground()
}

interface CapacitorAppPlugin {
  addListener: (
    event: 'appStateChange',
    cb: (state: { isActive: boolean }) => void,
  ) => Promise<{ remove: () => void }> | { remove: () => void }
}

function capacitorApp(): CapacitorAppPlugin | null {
  // 运行时由 Capacitor 注入，不静态依赖 @capacitor/app，Web 构建不受影响
  const plugins = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } })
    .Capacitor?.Plugins
  const app = plugins?.App as CapacitorAppPlugin | undefined
  return app && typeof app.addListener === 'function' ? app : null
}

export function startForegroundSync(): void {
  if (!isMobileClient() || unsubs.length > 0) return

  const app = capacitorApp()
  if (app) {
    const handle = app.addListener('appStateChange', ({ isActive }) => {
      if (isActive) enterForeground()
      else enterBackground()
    })
    unsubs.push(() => {
      void Promise.resolve(handle).then((h) => h.remove()).catch(() => { /* ignore */ })
    })
  }

  // 鸿蒙 ArkWeb 与未装 @capacitor/app 的场景靠 visibilitychange 兜底
  const onVisibility = () => {
    if (document.visibilityState === 'visible') enterForeground()
    else enterBackground()
  }
  document.addEventListener('visibilitychange', onVisibility)
  unsubs.push(() => document.removeEventListener('visibilitychange', onVisibility))

  // WebView 被系统回收后重建：pageshow 也要走一遍 hydrate
  const onPageShow = () => enterForeground()
  window.addEventListener('pageshow', onPageShow)
  unsubs.push(() => window.removeEventListener('pageshow', onPageShow))

  // 鸿蒙点推送拉起：此时 Socket 还没连上，先 hydrate 拿到来电现场
  unsubs.push(onHarmonyEvent('pushIncomingCall', () => {
    void hydrateOnForeground()
  }))
}

export function stopForegroundSync(): void {
  for (const off of unsubs) off()
  unsubs = []
}
