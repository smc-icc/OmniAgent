import { describe, expect, it } from 'vitest';
import {
  bumpHeatmap,
  compositeScore,
  csvEscape,
  dayKey,
  emptyHeatmap,
  parseDayRange,
  personalWindow,
  ratingToCsatPct,
  yoyDelta,
} from '../shared/services/omni-metrics.js';

describe('omni metrics helpers', () => {
  it('parses day range', () => {
    expect(parseDayRange()).toBeUndefined();
    const r = parseDayRange('2026-09-01', '2026-09-06');
    expect(r?.gte?.getFullYear()).toBe(2026);
    expect(r?.gte?.getMonth()).toBe(8);
    expect(r?.gte?.getDate()).toBe(1);
    expect(r?.lte).toBeInstanceOf(Date);
  });

  it('converts rating to CSAT %', () => {
    expect(ratingToCsatPct(5, 1)).toBe(100);
    expect(ratingToCsatPct(4, 2)).toBe(80);
    expect(ratingToCsatPct(null, 0)).toBeNull();
  });

  it('escapes CSV fields', () => {
    expect(csvEscape('ok')).toBe('ok');
    expect(csvEscape('a,b')).toBe('"a,b"');
    expect(csvEscape('say "hi"')).toBe('"say ""hi"""');
  });

  it('builds heatmap buckets', () => {
    const h = emptyHeatmap();
    bumpHeatmap(h.matrix, new Date('2026-09-06T10:15:00'));
    const day = new Date('2026-09-06T10:15:00').getDay();
    expect(h.matrix[day][10]).toBe(1);
    expect(dayKey(new Date('2026-09-06T00:00:00')).endsWith('09-06')).toBe(true);
  });

  it('computes yoy and composite', () => {
    expect(yoyDelta(110, 100).yoy).toContain('+');
    expect(compositeScore(100, 10, 120)).toBeGreaterThan(80);
  });

  it('builds personal windows', () => {
    const day = personalWindow('day');
    expect(day.label).toBe('今日');
    expect(day.from.getHours()).toBe(0);
    const week = personalWindow('week');
    expect(week.label).toBe('近7日');
    expect(week.to.getTime()).toBeGreaterThanOrEqual(week.from.getTime());
    const month = personalWindow('month');
    expect(month.label).toMatch(/^\d{4}-\d{2}$/);
  });
});
