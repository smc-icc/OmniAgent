import { useProductModulesStore } from '@/stores/product-modules'
import { createRouter, createWebHistory } from 'vue-router'
import MainLayout from '@/layouts/MainLayout.vue'
import MobileLayout from '@/layouts/MobileLayout.vue'
import { useAuthStore } from '@/stores/auth'
import { useAccessStore } from '@/stores/access'
import { pagePermissions } from '@/utils/access'
import { useMobileLayout } from '@/utils/platform'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    { path: '/video/:entryId', name: 'video-visitor', component: () => import('@/views/VideoVisitor.vue'), meta: { public: true } },
    { path: '/voice/:entryId', name: 'voice-visitor', component: () => import('@/views/VideoVisitor.vue'), meta: { public: true } },
    // 历史坐席链接统一进入全媒体客服；访客 /video/:entryId 保持原接入地址。
    { path: '/video', redirect: { name: 'omnichannel' } },
    { path: '/video-agent', name: 'video-agent', redirect: { name: 'omnichannel' } },
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/LoginView.vue'),
      meta: { public: true },
    },
    {
      // 数据大屏（投屏墙）：免密只读，避免电视占用坐席账号
      path: '/wallboard',
      name: 'wallboard',
      component: () => import('@/views/WallboardView.vue'),
      meta: { title: '数据大屏', permission: 'report.read' },
    },
    {
      path: '/',
      component: MainLayout,
      children: [
        {
          path: '',
          name: 'personal',
          component: () => import('@/views/PersonalDashboard.vue'),
          meta: { title: '个人看板' },
        },
        {
          path: 'omnichannel',
          name: 'omnichannel',
          component: () => import('@/views/OmnichannelService.vue'),
          meta: { title: '全媒体客服' },
        },
        {
          // 留言中心：语音留言 + 在线留言 + 离线消息 的统一入口。
          // 作为一级页面直达，不再挂在业务导航下多一层跳转。
          path: 'messages',
          name: 'messages',
          component: () => import('@/components/business-nav/VoicemailOfflineTab.vue'),
          meta: { title: '留言' },
        },
        {
          path: 'business-nav',
          name: 'business-nav',
          component: () => import('@/views/BusinessNavView.vue'),
          meta: { title: '业务导航' },
        },
        {
          path: 'outbound',
          name: 'outbound',
          component: () => import('@/views/OutboundView.vue'),
          meta: { title: '智能外呼' },
        },
        {
          path: 'monitor',
          name: 'monitor',
          component: () => import('@/views/MonitorView.vue'),
          meta: { title: '坐席监控' },
        },
        {
          path: 'inspection',
          name: 'inspection',
          component: () => import('@/views/InspectionView.vue'),
          meta: { title: '智能检测' },
        },
        {
          path: 'inspection/:id',
          name: 'inspection-detail',
          component: () => import('@/views/QualityInspectionDetail.vue'),
          meta: { title: '质检详情' },
        },
        {
          path: 'inspection-manage',
          name: 'inspection-manage',
          component: () => import('@/views/QcManageView.vue'),
          meta: { title: '质检管理' },
        },
        {
          path: 'contacts',
          redirect: '/access-management',
        },
        {
          path: 'access-management',
          name: 'access-management',
          component: () => import('@/views/AccessManagementView.vue'),
          meta: { title: '角色权限管理', permission: 'access.manage' },
        },
        {
          path: 'knowledge',
          name: 'knowledge',
          component: () => import('@/components/KnowledgeWorkspace.vue'),
          meta: { title: '知识库', permission: 'knowledge.read' },
        },
        {
          // 短信模板已并入「功能入口 → 短信管理 → 模板管理」，不再单列路由。
          // 保留旧路径重定向，避免历史书签 404。
          path: 'sms-templates',
          redirect: { path: '/business-nav', query: { tile: '短信管理' } },
        },
        {
          path: 'customers',
          name: 'customers',
          component: () => import('@/views/CustomersView.vue'),
          meta: { title: '客户管理' },
        },
        {
          path: 'customers/:id',
          name: 'customer-profile',
          component: () => import('@/views/CustomerProfileView.vue'),
          meta: { title: '客户画像' },
        },
        {
          path: 'opportunities',
          name: 'opportunities',
          component: () => import('@/views/OpportunitiesBoardView.vue'),
          meta: { title: '商机看板' },
        },
        {
          path: 'settings',
          name: 'settings',
          component: () => import('@/views/SettingsView.vue'),
          meta: { title: '设置' },
        },
        {
          path: 'rest-requests',
          name: 'rest-requests',
          component: () => import('@/views/RestRequestsView.vue'),
          meta: { title: '小休申请记录' },
        },
      ],
    },
    {
      // 移动坐席：独立布局与独立视图，不复用桌面五列栅格的全媒体页。
      // mobileFill=true 的页面自己撑满主区，外层不再套一层滚动。
      path: '/m',
      component: MobileLayout,
      children: [
        { path: '', redirect: '/m/sessions' },
        {
          path: 'knowledge',
          name: 'm-knowledge',
          component: () => import('@/components/KnowledgeWorkspace.vue'),
          meta: { title: '知识库', permission: 'knowledge.read' },
        },
        {
          path: 'sessions',
          name: 'm-sessions',
          component: () => import('@/views/mobile/MobileSessionList.vue'),
          meta: { title: '全媒体', permission: 'conversation.read' },
        },
        {
          path: 'sessions/:id',
          name: 'm-chat',
          component: () => import('@/views/mobile/MobileChat.vue'),
          meta: { title: '会话', permission: 'conversation.read', mobileFill: true },
        },
        {
          path: 'dialer',
          name: 'm-dialer',
          component: () => import('@/views/mobile/MobileDialer.vue'),
          meta: { title: '话务', mobileFill: true },
        },
        {
          path: 'messages',
          name: 'm-messages',
          component: () => import('@/views/mobile/MobileMessages.vue'),
          meta: { title: '留言', permission: 'voicemail.read' },
        },
        {
          path: 'customers/:id',
          name: 'm-customer',
          component: () => import('@/views/mobile/MobileCustomer.vue'),
          meta: { title: '客户资料', permission: 'customer.read' },
        },
        {
          path: 'profile',
          name: 'm-profile',
          component: () => import('@/views/mobile/MobileProfile.vue'),
          meta: { title: '我的' },
        },
      ],
    },
  ],
})

/** 桌面路径 → 移动路径。未列出的桌面页在移动端一律落到会话列表。 */
const DESKTOP_TO_MOBILE: Record<string, string> = {
  '/knowledge': '/m/knowledge',
  '/': '/m/sessions',
  '/omnichannel': '/m/sessions',
  '/messages': '/m/messages',
  '/customers': '/m/sessions',
  '/settings': '/m/profile',
  '/rest-requests': '/m/profile',
}

/** 移动路径 → 桌面路径。视口变宽或在 PC 上打开移动链接时回落。 */
const MOBILE_TO_DESKTOP: Record<string, string> = {
  '/m/knowledge': '/knowledge',
  '/m': '/',
  '/m/sessions': '/omnichannel',
  '/m/dialer': '/omnichannel',
  '/m/messages': '/messages',
  '/m/profile': '/settings',
}

function mobileTargetFor(path: string): string {
  if (DESKTOP_TO_MOBILE[path]) return DESKTOP_TO_MOBILE[path]
  if (path.startsWith('/customers/')) return `/m${path}`
  return '/m/sessions'
}

function desktopTargetFor(path: string): string {
  if (MOBILE_TO_DESKTOP[path]) return MOBILE_TO_DESKTOP[path]
  if (path.startsWith('/m/sessions/')) return '/omnichannel'
  if (path.startsWith('/m/customers/')) return path.slice(2)
  return '/'
}

/** 按客户端形态选择布局；登录页与大屏两端共用，不参与切换。 */
function layoutRedirect(path: string): string | null {
  const isMobilePath = path === '/m' || path.startsWith('/m/')
  if (useMobileLayout()) return isMobilePath ? null : mobileTargetFor(path)
  return isMobilePath ? desktopTargetFor(path) : null
}

router.beforeEach(async (to) => {
  if (to.name && pagePermissions[String(to.name)]) to.meta.permission = pagePermissions[String(to.name)]
  if (to.meta.public) return true
  if (to.name !== 'wallboard') {
    const redirect = layoutRedirect(to.path)
    if (redirect && redirect !== to.path) return { path: redirect, query: to.query }
  }
  const auth = useAuthStore()
  if (!auth.isLoggedIn) {
    const result = await auth.autoLogin()
    if (result === true) {
      await auth.startSocket()
      const modules=useProductModulesStore(); await modules.refresh()
      if (!modules.canVisit(to.path)) return { path: useMobileLayout() ? '/m/sessions' : '/omnichannel' }
      if (to.meta.permission) {
        const access = useAccessStore()
        await access.refresh()
        if (!access.can(String(to.meta.permission)) && !(to.name === 'access-management' && (access.can('extension.assign') || access.can('extension.approve')))) return { path: useMobileLayout() ? '/m/profile' : '/' }
      }
      return true
    }
    if (result === 'session_expired') {
      return { name: 'login' }
    }
    return { name: 'login', query: { redirect: to.fullPath } }
  }
  const modules=useProductModulesStore(); await modules.refresh()
  if (!modules.canVisit(to.path)) return { path: useMobileLayout() ? '/m/sessions' : '/omnichannel' }
  const alive = await auth.ensureCcsSessionAlive()
  if (alive === 'expired') {
    return { name: 'login' }
  }
  if (to.meta.permission) {
    const access = useAccessStore()
    await access.refresh()
    if (!access.can(String(to.meta.permission))) return { path: useMobileLayout() ? '/m/profile' : '/' }
  }
  return true
})

export default router
