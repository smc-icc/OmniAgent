export type DayMode = 'hours' | 'all_day' | 'closed'
export interface VdnHour {
  day_of_week: number
  closed_all_day?: boolean
  open_all_day?: boolean
  open_hour?: number
  open_minutes?: number
  close_hour?: number
  close_minutes?: number
}
export interface VdnHourDraft { day_of_week: number; mode: DayMode; open_time: string; close_time: string }
export const dayNames = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const clock = (hour = 0, minute = 0) => `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
export function draftVdnHours(input: Record<string | number, VdnHour> | VdnHour[]): VdnHourDraft[] {
  const byDay = new Map(Object.values(input).map(row => [row.day_of_week, row]))
  return [1, 2, 3, 4, 5, 6, 0].map(day => {
    const row = byDay.get(day)
    const mode: DayMode = row?.closed_all_day ? 'closed' : row?.open_all_day ? 'all_day' : !row && (day === 0 || day === 6) ? 'closed' : 'hours'
    return { day_of_week: day, mode, open_time: mode === 'hours' ? clock(row?.open_hour ?? 9, row?.open_minutes ?? 0) : '09:00', close_time: mode === 'hours' ? clock(row?.close_hour ?? 18, row?.close_minutes ?? 0) : '18:00' }
  })
}
export function serializeVdnHours(rows: VdnHourDraft[]): VdnHour[] {
  if (rows.length !== 7 || new Set(rows.map(row => row.day_of_week)).size !== 7 || rows.some(row => !Number.isInteger(row.day_of_week) || row.day_of_week < 0 || row.day_of_week > 6)) throw new Error('请完整配置一周七天的值班时间')
  return rows.map(row => {
    if (row.mode === 'closed') return { day_of_week: row.day_of_week, closed_all_day: true, open_all_day: false, open_hour: 0, open_minutes: 0, close_hour: 0, close_minutes: 0 }
    if (row.mode === 'all_day') return { day_of_week: row.day_of_week, closed_all_day: false, open_all_day: true, open_hour: 0, open_minutes: 0, close_hour: 23, close_minutes: 59 }
    if (row.mode !== 'hours' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.open_time) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(row.close_time) || row.open_time >= row.close_time) throw new Error(`${dayNames[row.day_of_week]}的结束时间须晚于开始时间`)
    const [open_hour, open_minutes] = row.open_time.split(':').map(Number)
    const [close_hour, close_minutes] = row.close_time.split(':').map(Number)
    return { day_of_week: row.day_of_week, closed_all_day: false, open_all_day: false, open_hour: open_hour!, open_minutes: open_minutes!, close_hour: close_hour!, close_minutes: close_minutes! }
  })
}
