import type { InjectionKey, Ref } from 'vue'

export const SCREENSHOT_HIDE_TARGET: InjectionKey<Ref<HTMLElement | null>> = Symbol('screenshotHideTarget')
export const SCREENSHOT_LONG_TARGET: InjectionKey<Ref<HTMLElement | null>> = Symbol('screenshotLongTarget')

export const HIDE_WINDOW_STORAGE_KEY = 'omni_screenshot_hide_window'

export type ScreenshotAction =
  | 'screenshot'
  | 'record'
  | 'long'
  | 'ocr'
  | 'translate'
