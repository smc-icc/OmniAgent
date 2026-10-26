import { io, Socket } from 'socket.io-client'
import { ref } from 'vue'
import { getClientKind, isMobileClient, resolveSocketUrl } from '@/utils/platform'
import { getOmniDeviceId } from '@/utils/device'

const SOCKET_URL = resolveSocketUrl()
const SOCKET_PATH = '/cable'

export const connected = ref(false)
export const messages = ref<Array<{
  id: string | number
  content: string
  conversation_id: number
  message_type?: string
  created_at?: string
}>>([])

let socket: Socket | null = null

export function connectSocket(token: string, accountId: number): Promise<Socket> {
  if (socket?.connected) {
    connected.value = true
    return Promise.resolve(socket)
  }

  // 复用未完成的握手，避免重复 io() 导致竞态
  const handshake = {
    token,
    client: getClientKind(),
    device_id: getOmniDeviceId(),
  }

  if (socket && !socket.connected) {
    socket.auth = handshake
    socket.connect()
  } else {
    socket = io(SOCKET_URL, {
      path: SOCKET_PATH,
      transports: ['websocket', 'polling'],
      auth: handshake,
      query: handshake,
      // 移动端 WebView 的 beforeunload 不可靠，且切后台不应触发离队
      closeOnBeforeunload: !isMobileClient(),
    })

    socket.on('connect', () => {
      console.log('[Socket] Connected:', socket?.id)
      connected.value = true
      socket?.emit('subscribe', { account_id: accountId })
      // 闪断重连：hydrate UI status + CCS callPhase；后端同时 flush 缓冲 evt（bindCcsEvents 仍生效即可）
      void import('@/stores/agent')
        .then(({ useAgentStore }) => useAgentStore().hydrateStatus())
        .catch(() => { /* ignore */ })
    })

    socket.on('disconnect', () => {
      console.log('[Socket] Disconnected')
      connected.value = false
    })

    socket.on('connect_error', (err) => {
      console.error('[Socket] connect_error:', err.message)
    })

    socket.on('message.created', (data: any) => {
      console.log('[Socket] message.created:', data)
      messages.value.push({
        id: data.id ?? Date.now(),
        content: data.content ?? '',
        conversation_id: data.conversation_id,
        message_type: data.message_type,
        created_at: data.created_at ?? new Date().toISOString(),
      })
    })

    socket.on('conversation.created', (data: any) => {
      console.log('[Socket] conversation.created:', data)
      window.dispatchEvent(new CustomEvent('omni:conversation-created', { detail: data }))
    })

    socket.on('conversation.status_changed', (data: any) => {
      window.dispatchEvent(new CustomEvent('omni:conversation-status-changed', { detail: data }))
    })

    socket.on('conversation.lifecycle_changed', (data: any) => {
      window.dispatchEvent(new CustomEvent('omni:conversation-lifecycle-changed', { detail: data }))
    })

    socket.on('conversation.assigned', (data: any) => {
      window.dispatchEvent(new CustomEvent('omni:conversation-lifecycle-changed', { detail: data }))
    })

    socket.on('extension.binding_processing_finished', (data: {vdn_id:number}) => {
      window.dispatchEvent(new CustomEvent('omni:extension-binding-processing-finished',{detail:data}))
    })
    socket.on('extension.binding_processing', (data: { vdn_id:number; operation_id:string; binding_version:number }) => {
      window.dispatchEvent(new CustomEvent('omni:extension-binding-processing', { detail:data }))
    })
    socket.on('extension.binding_changed', (data: { vdn_id:number; binding_version:number; extension:string }) => {
      window.dispatchEvent(new CustomEvent('omni:extension-binding-changed', { detail:data }))
    })

    socket.on('omni.phone_conversation', (data: any) => {
      window.dispatchEvent(new CustomEvent('omni:phone-conversation', { detail: data }))
    })

    socket.on('conversation.unread_changed', (data: {
      conversation_id: number
      unread: number
      last_activity_at?: number | null
    }) => {
      window.dispatchEvent(new CustomEvent('omni:unread-changed', { detail: data }))
    })

    socket.on('voicemail.created', (data: unknown) => {
      window.dispatchEvent(new CustomEvent('omni:voicemail-created', { detail: data }))
    })

    socket.on('presence.update', (data: any) => {
      console.log('[Socket] presence.update:', data)
    })

    socket.on('notification.created', (data: any) => {
      console.log('[Socket] notification.created:', data)
    })

    socket.on('ccs.down', () => {
      void import('@/utils/ccs-health').then(async ({ isOnLoginPage, tabHadCcsSignIn }) => {
        if (isOnLoginPage()) return
        const { useAgentStore } = await import('@/stores/agent')
        const agent = useAgentStore()
        if (!tabHadCcsSignIn({ agentId: agent.agentId, callActive: agent.callPhase !== 'idle' })) {
          return
        }
        const { useAuthStore } = await import('@/stores/auth')
        await useAuthStore().forceLogoutToLogin()
      }).catch(() => { /* ignore */ })
    })

    socket.on('ccs.health', (data: {
      up?: boolean
      generation?: number
      bootId?: string
      logged_in?: boolean
    }) => {
      void import('@/stores/agent').then(({ useAgentStore }) =>
        useAgentStore().applyCcsHealth({
          up: data?.up === true,
          generation: typeof data?.generation === 'number' ? data.generation : 0,
          bootId: data?.bootId,
          logged_in: data?.logged_in,
        }),
      ).catch(() => { /* ignore */ })
    })

    socket.on('auth.kicked', async (data: { message?: string; session_id?:string }) => {
      const {useAuthStore}=await import('@/stores/auth')
      const auth=useAuthStore()
      if(data.session_id && auth.user?.session_id && data.session_id!==auth.user.session_id)return
      void import('element-plus').then(({ ElMessage }) => {
        ElMessage.warning(data?.message || '账号已在其他终端登录')
      }).catch(() => { /* ignore */ })
      void import('@/stores/auth').then(({ useAuthStore }) =>
        useAuthStore().forceLogoutToLogin(),
      ).catch(() => { /* ignore */ })
    })
  }

  return new Promise((resolve, reject) => {
    const s = socket!
    if (s.connected) {
      connected.value = true
      resolve(s)
      return
    }
    const timeoutMs = 15000
    const timer = setTimeout(() => {
      s.off('connect', onConnect)
      s.off('connect_error', onErr)
      reject(new Error('Socket connect timeout'))
    }, timeoutMs)
    const onConnect = () => {
      clearTimeout(timer)
      s.off('connect_error', onErr)
      resolve(s)
    }
    const onErr = (err: Error) => {
      clearTimeout(timer)
      s.off('connect', onConnect)
      reject(new Error(`Socket connect error: ${err.message}`))
    }
    s.once('connect', onConnect)
    s.once('connect_error', onErr)
  })
}

export function disconnectSocket() {
  socket?.disconnect()
  socket = null
  connected.value = false
}

export function sendMessage(conversationId: number, content: string) {
  // Messages are sent via REST API, not Socket.io
  // Socket.io is for receiving real-time events
  console.log('[Socket] send via REST:', { conversationId, content })
}

export function getSocket(): Socket | null {
  return socket
}

/** 关标签/关浏览器：立刻通知后端离队，不等心跳超时。 */
function notifyUiLeaving() {
  const s = socket
  if (!s) return
  try {
    s.volatile.emit('ccs.ui.leaving')
  } catch {
    /* ignore */
  }
  s.disconnect()
}

/** App 切后台：保持在队列，仅告知后端前台不可见，来电改由推送唤醒。 */
export function notifyUiBackground() {
  try {
    socket?.volatile.emit('ccs.ui.background')
  } catch {
    /* ignore */
  }
}

export function notifyUiForeground() {
  try {
    socket?.volatile.emit('ccs.ui.foreground')
  } catch {
    /* ignore */
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    // 移动端 pagehide 多数是切后台/WebView 休眠，不能当成关闭页面
    if (isMobileClient()) {
      notifyUiBackground()
      return
    }
    notifyUiLeaving()
  })
}
