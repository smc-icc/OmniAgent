import { api } from './client'

export async function fetchClassHoursMeta() {
  const { data } = await api.get('/api/class-hours/meta')
  return data as {
    campuses: { id: string; name: string }[]
    grade_options: { id: string; label: string }[]
    weekday_options: { value: number; label: string }[]
    period_options: { id: string; label: string }[]
    teacher_group_options: string[]
    teacher_options: { id: string; name: string }[]
    course_options: { name: string }[]
    dimension_options: { value: string; label: string }[]
    default_date_start: string
    default_date_end: string
  }
}

export async function postClassHoursQuery(body: {
  campus_id: string
  date_start: string
  date_end: string
  grade_ids: string[]
  weekday_values: number[]
  period_ids: string[]
  teacher_group: string
  teacher_name: string
  course_name: string
  dimension: string
  page: number
  page_size: number
}) {
  const { data } = await api.post('/api/class-hours/query', body)
  return data as {
    items: {
      id: string
      teacher_id: string
      teacher_name: string
      teacher_group: string
      grade: string
      course: string
      class_name: string
      head_class: string
      actual_hours: number
      converted_hours: number
      apply_substitute_private: number
      apply_substitute_public: number
      substitute_hours: number
      manual_hours: number
    }[]
    total: number
    page: number
    page_size: number
  }
}

export async function fetchClassHoursGradePeriodTree() {
  const { data } = await api.get<{ items: { id: string; label: string; children?: { id: string; label: string }[] }[] }>(
    '/api/class-hours/grade-period-tree',
  )
  return data.items
}

export async function postClassHoursManualAdjust(body: {
  teacher_id: string
  grade: string
  course: string
  value: number
}) {
  const { data } = await api.post('/api/class-hours/manual-adjust', body)
  return data as { ok: boolean; item: Record<string, unknown> }
}

export async function fetchClassHoursSettings() {
  const { data } = await api.get('/api/class-hours/settings')
  return data as {
    substitute_mode: string
    substitute_hours_factor: number
    course_coefficients: { course_name: string; value: number }[]
  }
}

export async function putClassHoursSettings(body: {
  substitute_mode: string
  substitute_hours_factor: number
  course_coefficients: { course_name: string; value: number }[]
}) {
  const { data } = await api.put('/api/class-hours/settings', body)
  return data as { ok: boolean }
}

export async function postClassHoursBatchCoefficient(body: { value: number; course_names: string[] }) {
  const { data } = await api.post('/api/class-hours/settings/batch-coefficient', body)
  return data as { ok: boolean; items: { course_name: string; value: number }[] }
}
