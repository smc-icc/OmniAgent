import { api } from './client'

export type ShiftCode = 'day' | 'mid' | 'night' | 'off' | 'leave'

export interface ShiftBoardSettings {
  id: number
  account_id: number
  name: string
  rhythm: string
  sequence: ShiftCode[]
  start_date: string
  duration: number
  need_per_shift: number
  time_day: string
  time_mid: string
  time_night: string
  hours_per_shift: number
  hourly_rate: number
  night_bonus: number
  theme: string
}

export interface ShiftBoardPayload {
  board: ShiftBoardSettings
  staff: Array<{ id: number; name: string; sort_order: number }>
  leaves: Array<{
    id: number
    staff_name: string
    from_date: string
    to_date: string
    type: string
  }>
  notes: Record<string, string>
  dates: string[]
  grid: Array<{
    name: string
    work_count: number
    cells: Array<{ date: string; shift: ShiftCode; manual: boolean; warn: boolean }>
  }>
  daily: Array<{ date: string; day: number; mid: number; night: number }>
  stats: {
    staff_count: number
    total_hours: number
    night_count: number
    night_bonus_total: number
    estimated_pay: number
  }
}

export async function fetchShiftBoard() {
  const { data } = await api.get<ShiftBoardPayload>('/api/agent-shifts')
  return data
}

export async function patchShiftBoard(
  payload: Partial<{
    name: string
    rhythm: string
    sequence: ShiftCode[]
    start_date: string
    duration: number
    need_per_shift: number
    time_day: string
    time_mid: string
    time_night: string
    hours_per_shift: number
    hourly_rate: number
    night_bonus: number
    theme: string
    clear_manuals: boolean
  }>,
) {
  const { data } = await api.patch<ShiftBoardPayload>('/api/agent-shifts', payload)
  return data
}

export async function addShiftStaff(name: string) {
  const { data } = await api.post<ShiftBoardPayload>('/api/agent-shifts/staff', { name })
  return data
}

export async function removeShiftStaff(id: number) {
  const { data } = await api.delete<ShiftBoardPayload>(`/api/agent-shifts/staff/${id}`)
  return data
}

export async function addShiftLeave(payload: {
  staff_name: string
  from_date: string
  to_date: string
  type?: string
}) {
  const { data } = await api.post<ShiftBoardPayload>('/api/agent-shifts/leaves', payload)
  return data
}

export async function removeShiftLeave(id: number) {
  const { data } = await api.delete<ShiftBoardPayload>(`/api/agent-shifts/leaves/${id}`)
  return data
}

export async function cycleShiftCell(staff_name: string, date: string) {
  const { data } = await api.post<ShiftBoardPayload>('/api/agent-shifts/cell', {
    staff_name,
    date,
  })
  return data
}

export async function upsertShiftNote(date: string, text: string) {
  const { data } = await api.post<ShiftBoardPayload>('/api/agent-shifts/notes', { date, text })
  return data
}

export async function deleteShiftNote(date: string) {
  const { data } = await api.delete<ShiftBoardPayload>('/api/agent-shifts/notes', {
    params: { date },
  })
  return data
}

export async function fillShiftHolidays2026() {
  const { data } = await api.post<ShiftBoardPayload>('/api/agent-shifts/holidays-2026')
  return data
}

export function shiftExportCsvUrl() {
  return '/api/agent-shifts/export.csv'
}
