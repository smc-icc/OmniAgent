import { api } from './client'

export type TransferSkill = { id: number; name: string }
export type TransferGroup = { id: number; name: string; skills: TransferSkill[] }
export type TransferAgent = { workNo: string; name: string; groupId: number }
export type TransferIvrFlow = { id: number; name: string; flowId: number; nodeId: number }

export async function fetchTransferCatalog(mode?: 'skill' | 'agent' | 'consult') {
  const { data } = await api.get<{
    vdn_id: number
    groups: TransferGroup[]
    ivr_flows: TransferIvrFlow[]
  }>('/api/agent/transfer/catalog', {
    params: mode ? { mode } : undefined,
  })
  return data
}

export async function fetchTransferAgents(groupId: number, search = '') {
  const { data } = await api.get<{ group_id: number; agents: TransferAgent[] }>(
    '/api/agent/transfer/agents',
    { params: { groupId, search: search || undefined } },
  )
  return data
}
