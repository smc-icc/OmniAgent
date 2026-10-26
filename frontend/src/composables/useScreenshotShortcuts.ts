import { onMounted, onUnmounted, type Ref } from 'vue'
import type { ScreenshotAction } from '@/components/chat/screenshot-context'

const SHORTCUT_MAP: Record<string, ScreenshotAction> = {
  a: 'screenshot',
  c: 'long',
  o: 'ocr',
  f: 'translate',
}

export function useScreenshotShortcuts(
  enabled: Ref<boolean>,
  onAction: (action: ScreenshotAction) => void,
) {
  function onKeyDown(e: KeyboardEvent) {
    if (!enabled.value) return
    if (!e.ctrlKey || !e.altKey || e.shiftKey) return
    const key = e.key.toLowerCase()
    const action = SHORTCUT_MAP[key]
    if (!action) return
    e.preventDefault()
    onAction(action)
  }

  onMounted(() => document.addEventListener('keydown', onKeyDown))
  onUnmounted(() => document.removeEventListener('keydown', onKeyDown))
}
