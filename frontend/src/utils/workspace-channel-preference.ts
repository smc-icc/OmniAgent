export interface WorkspaceIdentity { accountId: number; userId: number }
type ChannelGroup = 'media' | 'phone'
type PreferenceStorage = Pick<Storage, 'getItem' | 'setItem'>
function key(identity: WorkspaceIdentity): string | null {
  return Number.isSafeInteger(identity.accountId) && identity.accountId > 0
    && Number.isSafeInteger(identity.userId) && identity.userId > 0
    ? `omni.workspace.channel:${identity.accountId}:${identity.userId}` : null
}
export function readWorkspaceChannelPreference(identity: WorkspaceIdentity, storage?: PreferenceStorage, iccAvailable = true): ChannelGroup {
  try {
    const name = key(identity)
    if (!name) return 'media'
    const value = (storage ?? globalThis.localStorage)?.getItem(name)
    return iccAvailable && value === 'phone' ? 'phone' : 'media'
  } catch { return 'media' }
}
export function writeWorkspaceChannelPreference(identity: WorkspaceIdentity, channel: ChannelGroup, storage?: PreferenceStorage): void {
  try {
    const name = key(identity)
    if (name && (channel === 'phone' || channel === 'media')) (storage ?? globalThis.localStorage)?.setItem(name, channel)
  } catch { /* Private browsing/storage restrictions cannot break the workspace. */ }
}
