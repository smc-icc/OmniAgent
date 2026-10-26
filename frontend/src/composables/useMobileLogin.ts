import { onMounted, onUnmounted, ref } from 'vue'
import { getNativeShell } from '@/utils/platform'
import { mobileLoginLayout } from '@/services/auth/mobile-login-policy'

export function useMobileLogin() {
  const mobile = ref(mobileLoginLayout(getNativeShell(), window.innerWidth))
  const height = ref(window.visualViewport?.height ?? window.innerHeight)
  const update = () => {
    mobile.value = mobileLoginLayout(getNativeShell(), window.innerWidth)
    height.value = window.visualViewport?.height ?? window.innerHeight
  }
  onMounted(() => {
    update()
    window.addEventListener('resize', update)
    window.visualViewport?.addEventListener('resize', update)
  })
  onUnmounted(() => {
    window.removeEventListener('resize', update)
    window.visualViewport?.removeEventListener('resize', update)
  })
  return { mobile, height }
}
