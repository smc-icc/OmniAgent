export interface PasswordLoginInput { email: string; password: string }
export interface PasswordLoginDependencies {
  login(email: string, password: string): Promise<unknown>
  startup(): Promise<void>
  setWorkNumber(): void
  destination(): string
}

/**
 * 只放行站内路径，挡住开放重定向：必须是单个 '/' 开头的绝对路径，
 * 排除 '//evil.com' 和 '/\evil.com' 这类协议相对写法，登录页自身也不做落点。
 */
export function sanitizeRedirect(redirect: unknown): string | null {
  const raw = Array.isArray(redirect) ? redirect[0] : redirect
  if (typeof raw !== 'string') return null
  const value = raw.trim()
  if (!value.startsWith('/')) return null
  if (value.startsWith('//') || value.startsWith('/\\')) return null
  if (value === '/login' || value.startsWith('/login?') || value.startsWith('/login/')) return null
  return value
}

/**
 * Route presentation uses the server identity; API authorization stays on the server.
 *
 * redirect 来自登录页的 ?redirect=，登录成功后优先回到用户原本想去的页面
 * （例如 /video-agent 视频坐席工作台、/video 别名）。没有合法 redirect 时才按
 * 超管/移动端落到默认首页。
 */
export function loginDestination(systemSuperuser: boolean, mobile: boolean, redirect?: unknown): string {
  const target = sanitizeRedirect(redirect)
  if (target) return target
  return systemSuperuser ? '/access-management' : mobile ? '/m/sessions' : '/'
}

export async function passwordLogin(input: PasswordLoginInput, deps: PasswordLoginDependencies): Promise<string> {
  await deps.login(input.email, input.password)
  deps.setWorkNumber()
  await deps.startup()
  return deps.destination()
}
