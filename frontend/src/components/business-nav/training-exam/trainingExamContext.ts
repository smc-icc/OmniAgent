import type { InjectionKey, Ref } from 'vue'
import { inject, ref } from 'vue'

export interface TeQuestionBank {
  id: string
  name: string
  singleCount: number
  multiCount: number
  judgeCount: number
  createdAt: string
  remark?: string
}

export type TeQType = '单选题' | '多选题' | '判断题'

export interface TeQuestionOption {
  isAnswer: boolean
  content: string
  optAnalysis: string
}

export interface TeQuestion {
  id: string
  bankId: string
  type: TeQType
  difficulty: '普通' | '较难'
  content: string
  analysis: string
  options: TeQuestionOption[]
  createdAt: string
}

export interface TePaperRow {
  bankId: string
  nSingle: number
  sSingle: number
  nMulti: number
  sMulti: number
  nJudge: number
  sJudge: number
}

export interface TeExam {
  id: string
  name: string
  openType: string
  unlimitedTime: boolean
  startAt: string | null
  endAt: string | null
  timeText: string
  totalScore: number
  passScore: number
  status: string
  paperRows: TePaperRow[]
  permScope: 'public' | 'dept'
  permDeptKeys: string[]
}

export interface TrainingExamState {
  banks: Ref<TeQuestionBank[]>
  questions: Ref<TeQuestion[]>
  exams: Ref<TeExam[]>
}

export const TRAINING_EXAM_KEY: InjectionKey<TrainingExamState> = Symbol('trainingExam')

function padBankCounts(b: TeQuestionBank, questions: TeQuestion[]) {
  const mine = questions.filter((q) => q.bankId === b.id)
  b.singleCount = mine.filter((q) => q.type === '单选题').length
  b.multiCount = mine.filter((q) => q.type === '多选题').length
  b.judgeCount = mine.filter((q) => q.type === '判断题').length
}

export function recalcBankCounts(banks: TeQuestionBank[], questions: TeQuestion[]) {
  banks.forEach((b) => padBankCounts(b, questions))
}

function seedBanks(): TeQuestionBank[] {
  const t = '2022-11-02 09:47:44'
  return [
    {
      id: '1587622451624120321',
      name: '【云帆】演示题库',
      singleCount: 12,
      multiCount: 8,
      judgeCount: 5,
      createdAt: t,
    },
    {
      id: '1587622451624120322',
      name: '111',
      singleCount: 2,
      multiCount: 1,
      judgeCount: 0,
      createdAt: t,
    },
    {
      id: '1587622451624120323',
      name: '11',
      singleCount: 0,
      multiCount: 0,
      judgeCount: 1,
      createdAt: t,
    },
    {
      id: '1587622451624120324',
      name: 'test',
      singleCount: 3,
      multiCount: 3,
      judgeCount: 2,
      createdAt: t,
    },
  ]
}

function seedQuestions(banks: TeQuestionBank[]): TeQuestion[] {
  const bankId = banks[0]?.id ?? ''
  const types: TeQType[] = ['判断题', '多选题', '单选题']
  const samples = [
    'Tides on Earth are caused by the moon\'s gravity.',
    'Which of the following are renewable energy sources?',
    'Select the correct formula for water.',
  ]
  const out: TeQuestion[] = []
  for (let i = 0; i < 29; i++) {
    const typ = types[i % 3]
    out.push({
      id: `q-${i + 1}`,
      bankId: banks[i % banks.length]?.id ?? bankId,
      type: typ,
      difficulty: i % 4 === 0 ? '较难' : '普通',
      content: `${samples[i % 3]} (${i + 1})`,
      analysis: '解析示例：请结合教材理解要点。',
      options:
        typ === '判断题'
          ? [
              { isAnswer: true, content: '正确', optAnalysis: '' },
              { isAnswer: false, content: '错误', optAnalysis: '' },
            ]
          : [
              { isAnswer: i % 2 === 0, content: '选项 A', optAnalysis: '' },
              { isAnswer: i % 2 !== 0, content: '选项 B', optAnalysis: '' },
              { isAnswer: false, content: '选项 C', optAnalysis: '' },
            ],
      createdAt: `2022-11-02 09:48:${String((30 + i) % 60).padStart(2, '0')}`,
    })
  }
  return out
}

function paperTotal(rows: TePaperRow[]): number {
  return rows.reduce(
    (s, r) =>
      s +
      r.nSingle * r.sSingle +
      r.nMulti * r.sMulti +
      r.nJudge * r.sJudge,
    0,
  )
}

function seedExams(banks: TeQuestionBank[]): TeExam[] {
  const out: TeExam[] = []
  for (let i = 0; i < 48; i++) {
    const unlimited = i % 3 === 0
    const row: TePaperRow = {
      bankId: banks[i % banks.length]?.id ?? '',
      nSingle: 10,
      sSingle: 5,
      nMulti: 5,
      sMulti: 6,
      nJudge: 5,
      sJudge: 4,
    }
    const total = paperTotal([row])
    const dept = i % 5 === 1
    out.push({
      id: `ex-${i + 1}`,
      name:
        i === 0 ? '【云帆演示】考试' : i === 1 ? '54654654654' : i === 2 ? 'test1111' : `考试批次-${i + 1}`,
      openType: dept ? '部门开放' : '完全公开',
      unlimitedTime: unlimited,
      startAt: unlimited ? null : '1981-02-06 00:00:00',
      endAt: unlimited ? null : '2025-10-09 23:59:59',
      timeText: unlimited ? '不限时' : '1981-02-06 ~ 2025-10-09',
      totalScore: i % 4 === 0 ? total : [100, 200, 700][i % 3],
      passScore: [60, 50, 0][i % 3],
      status: '正常',
      paperRows: [row],
      permScope: dept ? 'dept' : 'public',
      permDeptKeys: dept ? ['c1-hr'] : [],
    })
  }
  return out
}

export function createTrainingExamState(): TrainingExamState {
  const banksRef = ref<TeQuestionBank[]>([])
  const questionsRef = ref<TeQuestion[]>([])

  banksRef.value = seedBanks()
  questionsRef.value = seedQuestions(banksRef.value)
  recalcBankCounts(banksRef.value, questionsRef.value)

  const examsRef = ref<TeExam[]>(seedExams(banksRef.value))

  return {
    banks: banksRef,
    questions: questionsRef,
    exams: examsRef,
  }
}

export function useTrainingExam() {
  const ctx = inject(TRAINING_EXAM_KEY)
  if (!ctx) throw new Error('useTrainingExam: missing provider')
  return ctx
}

export { paperTotal }
