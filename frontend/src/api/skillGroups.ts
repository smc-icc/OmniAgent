import { api } from './client'

export type SkillNodeType = 'skill' | 'queue'

export interface SkillTreeNode {
  id: string
  label: string
  type: SkillNodeType
  disabled?: boolean
  children?: SkillTreeNode[]
  mediaKinds?: Array<'tas' | 'ims'>
}

export interface AgentSkillGroupsState {
  tree: SkillTreeNode[]
  signed_in: string[]
  display_label: string
}

export async function fetchAgentSkillGroups(opts?: { sync?: boolean }) {
  const { data } = await api.get<AgentSkillGroupsState>('/api/agent/skill-groups', {
    params: opts?.sync ? { sync: 1 } : undefined,
  })
  return data
}

export async function updateAgentSkillGroups(signedIn: string[]) {
  const { data } = await api.put<AgentSkillGroupsState>('/api/agent/skill-groups', {
    signed_in: signedIn,
  })
  return data
}

export async function signInAllSkillGroups() {
  const { data } = await api.post<AgentSkillGroupsState>('/api/agent/skill-groups/sign-in-all')
  return data
}

export async function signOutAllSkillGroups() {
  const { data } = await api.post<AgentSkillGroupsState>('/api/agent/skill-groups/sign-out-all')
  return data
}

export interface AcdQueuingState {
  media_queuing_mode: number
  caller_count: number
  queuing_confirmed: boolean
}

export async function fetchAcdQueuing() {
  const { data } = await api.get<AcdQueuingState>('/api/agent/acd-queuing')
  return data
}

export async function updateAcdQueuing(payload: Partial<AcdQueuingState>) {
  const { data } = await api.put<AcdQueuingState>('/api/agent/acd-queuing', payload)
  return data
}
