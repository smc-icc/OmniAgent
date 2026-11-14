import { Capacitor, registerPlugin } from '@capacitor/core'
import { loadAndroidSession, saveAndroidSession, type AndroidSessionStorage } from './android-session'
import { resolveApiBaseUrl } from '@/utils/platform'

interface SessionPlugin {
  readSavedSession(): Promise<{ value: string }>
  writeSavedSession(options: { value: string }): Promise<void>
  clearSavedSession(): Promise<void>
}

const plugin = registerPlugin<SessionPlugin>('OmniSip')
export function hasAndroidVault(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('OmniSip')
}
const storage: AndroidSessionStorage = {
  async read() { return (await plugin.readSavedSession()).value },
  async write(value) { await plugin.writeSavedSession({ value }) },
  async clear() { await plugin.clearSavedSession() },
}
function server(): string { return resolveApiBaseUrl() || window.location.origin }
export async function loadSavedAndroidToken(): Promise<string> {
  return hasAndroidVault() ? loadAndroidSession(storage, server()) : ''
}
export async function saveAndroidToken(token: string): Promise<void> {
  if (hasAndroidVault()) await saveAndroidSession(storage, server(), token)
}
export async function clearSavedAndroidToken(): Promise<void> {
  if (hasAndroidVault()) await storage.clear()
}
