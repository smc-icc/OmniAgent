import { registerPlugin } from '@capacitor/core'

/**
 * 业务代码不直接 import 本文件：运行时统一从 window.Capacitor.Plugins 取插件
 * （见 src/services/native-plugins.ts）。这里的导出只为单测与类型提示保留。
 */
export const OmniSip = registerPlugin('OmniSip')
export const OmniPush = registerPlugin('OmniPush')
