export type BiPeriod = '7d' | '30d';

export function parseDayRange(from?: string, to?: string): { gte?: Date; lte?: Date } | undefined {
  const gte = /^\d{4}-\d{2}-\d{2}$/.test(String(from || ''))
    ? new Date(`${from}T00:00:00`)
    : undefined;
  const lte = /^\d{4}-\d{2}-\d{2}$/.test(String(to || ''))
    ? new Date(`${to}T23:59:59.999`)
    : undefined;
  if (!gte && !lte) return undefined;
  return { ...(gte ? { gte } : {}), ...(lte ? { lte } : {}) };
}

export function periodWindow(period: BiPeriod): { from: Date; prevFrom: Date; prevTo: Date; days: number } {
  const days = period === '30d' ? 30 : 7;
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  from.setDate(from.getDate() - (days - 1));
  const prevTo = new Date(from.getTime() - 1);
  const prevFrom = new Date(from);
  prevFrom.setDate(prevFrom.getDate() - days);
  return { from, prevFrom, prevTo, days };
}

export function personalWindow(period?: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  const p = String(period || 'week');
  if (p === 'day') {
    const from = new Date(now);
    from.setHours(0, 0, 0, 0);
    return { from, to: now, label: '今日' };
  }
  if (p === 'month') return monthWindow();
  const from = new Date(now);
  from.setDate(from.getDate() - 6);
  from.setHours(0, 0, 0, 0);
  return { from, to: now, label: '近7日' };
}

export function monthWindow(periodYm?: string): { from: Date; to: Date; label: string } {
  const now = new Date();
  const m = String(periodYm || '').match(/^(\d{4})-(\d{2})$/);
  const y = m ? Number(m[1]) : now.getFullYear();
  const mo = m ? Number(m[2]) - 1 : now.getMonth();
  const from = new Date(y, mo, 1, 0, 0, 0, 0);
  const to = new Date(y, mo + 1, 0, 23, 59, 59, 999);
  return { from, to, label: `${y}-${String(mo + 1).padStart(2, '0')}` };
}

export function dayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function ratingToCsatPct(avg: number | null | undefined, count: number): number | null {
  if (!count || avg == null || !Number.isFinite(avg)) return null;
  return Math.round((avg / 5) * 1000) / 10;
}

export function yoyDelta(curr: number, prev: number, unit: 'pct' | 'num' = 'num'): { yoy: string; status: string } {
  if (!Number.isFinite(prev) || prev === 0) {
    if (!curr) return { yoy: '—', status: 'neutral' };
    return { yoy: '新', status: 'up' };
  }
  const diff = curr - prev;
  const pct = (diff / Math.abs(prev)) * 100;
  const status = diff > 0 ? 'up' : diff < 0 ? 'good' : 'neutral';
  if (unit === 'pct') {
    const sign = diff >= 0 ? '+' : '';
    return { yoy: `${sign}${Math.round(diff * 10) / 10}pt`, status };
  }
  const sign = pct >= 0 ? '+' : '';
  return { yoy: `${sign}${Math.round(pct * 10) / 10}%`, status };
}

export function compositeScore(csatPct: number | null, handled: number, ahtSec: number): number {
  const csatPart = csatPct == null ? 70 : csatPct;
  const volPart = Math.min(20, handled * 2);
  const ahtPart = ahtSec <= 0 ? 10 : Math.max(0, 10 - Math.max(0, ahtSec - 180) / 60);
  return Math.round((csatPart * 0.7 + volPart + ahtPart) * 10) / 10;
}

export function emptyHeatmap(): { day_labels: string[]; hour_labels: string[]; matrix: number[][] } {
  const day_labels = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'];
  const hour_labels = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);
  const matrix = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
  return { day_labels, hour_labels, matrix };
}

export function bumpHeatmap(matrix: number[][], at: Date): void {
  const d = at.getDay();
  const h = at.getHours();
  if (matrix[d] && matrix[d][h] != null) matrix[d][h] += 1;
}

export function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const KPI_DEFINITIONS = [
  {
    id: 'K_CSAT',
    name: '客户满意度',
    category: '结果质量',
    weight_pct: 25,
    unit: '%',
    formula_hint: '评价均分 / 5 × 100（csat_survey_responses.rating）',
    source_system: 'Omni CSAT',
  },
  {
    id: 'K_AHT',
    name: '平均处理时长',
    category: '效率',
    weight_pct: 20,
    unit: '秒',
    formula_hint: '会话 talk_sec 合计 / 已结束会话数',
    source_system: 'omni_session_records',
  },
  {
    id: 'K_HANDLED',
    name: '处理量',
    category: '效率与产能',
    weight_pct: 20,
    unit: '通',
    formula_hint: '周期内分配或结束的全媒体会话数',
    source_system: 'omni_session_records',
  },
  {
    id: 'K_WAIT',
    name: '平均等待',
    category: '服务水平',
    weight_pct: 15,
    unit: '秒',
    formula_hint: 'wait_sec 平均值',
    source_system: 'omni_session_records',
  },
  {
    id: 'K_QUALITY',
    name: '体验均分',
    category: '质量合规',
    weight_pct: 20,
    unit: '分',
    formula_hint: 'CSAT 5 分制均分（无独立质检表时与评价同分）',
    source_system: 'Omni CSAT',
  },
];
