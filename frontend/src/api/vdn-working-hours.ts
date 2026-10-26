import { api } from './client'
import type { VdnHour } from '@/utils/vdn-working-hours'
export interface VdnHoursPayload { vdn_id: number; working_hours: Record<string, VdnHour> | VdnHour[] }
export async function fetchVdnWorkingHours(): Promise<VdnHoursPayload> {
  return (await api.get<{ payload: VdnHoursPayload }>('/api/v1/vdn/working_hours')).data.payload
}
export async function saveVdnWorkingHours(working_hours: VdnHour[]): Promise<VdnHoursPayload> {
  return (await api.put<{ payload: VdnHoursPayload }>('/api/v1/vdn/working_hours', { working_hours })).data.payload
}
