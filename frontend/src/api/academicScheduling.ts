import { api } from './client'

export interface AcademicTerm {
  id: string
  school_year: string
  semester_name: string
  is_current: boolean
  start_date: string
  end_date: string
  weeks: number
}

export interface AutoUpgradeDates {
  school_year_date: string
  semester_date: string
}

export async function fetchAcademicTerms() {
  const { data } = await api.get<{ items: AcademicTerm[] }>('/api/scheduling/academic-terms')
  return data.items
}

export async function fetchAutoUpgradeDates() {
  const { data } = await api.get<AutoUpgradeDates>('/api/scheduling/auto-upgrade-dates')
  return data
}

export async function putAutoUpgradeDates(body: AutoUpgradeDates) {
  const { data } = await api.put<AutoUpgradeDates & { ok: boolean }>(
    '/api/scheduling/auto-upgrade-dates',
    body,
  )
  return data
}

export async function patchCurrentAcademicTerm(start_date: string, end_date: string) {
  const { data } = await api.patch<{ ok: boolean; item: AcademicTerm }>(
    '/api/scheduling/academic-terms/current',
    { start_date, end_date },
  )
  return data.item
}

export async function postAcademicUpgrade(new_start_date: string, new_end_date: string) {
  const { data } = await api.post<{
    ok: boolean
    message: string
    current: AcademicTerm
    items: AcademicTerm[]
  }>('/api/scheduling/academic-terms/upgrade', {
    new_start_date,
    new_end_date,
  })
  return data
}
