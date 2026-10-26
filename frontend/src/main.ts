import '@/utils/patchResizeObserver'
import { getNativeShell } from '@/utils/platform'
import { createApp, nextTick } from 'vue'

if (getNativeShell() !== 'web') {
  document.documentElement.classList.add('native-shell', `native-${getNativeShell()}`)
}
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import App from './App.vue'
import router from './router'
import './styles/global.css'
import { permissionDirective } from '@/utils/access'
import { registerNativePlugins } from '@/services/native-plugins'

const app = createApp(App)
app.directive('permission', permissionDirective)
app.use(createPinia())
app.use(router)
app.use(ElementPlus, { locale: zhCn })

// 原生插件要先挂上，界面里再去判断「本机有没有语音能力」才准
void registerNativePlugins().then(async () => {
  await router.isReady()
  app.mount('#app')
  await nextTick()
  requestAnimationFrame(() => {
    const launch = window as unknown as { __OMNI_FINISH_LAUNCH__?: () => void }
    launch.__OMNI_FINISH_LAUNCH__?.()
  })
}).catch(() => {
  const launch = window as unknown as { __OMNI_FAIL_LAUNCH__?: () => void }
  launch.__OMNI_FAIL_LAUNCH__?.()
})
