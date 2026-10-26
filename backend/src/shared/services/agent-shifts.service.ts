/**
 * 坐席排班：按 account 的排班板 + 自动节律 / 请假 / 手工覆盖。
 */
import type { PrismaClient } from '@prisma/client';

export type ShiftCode = 'day' | 'mid' | 'night' | 'off' | 'leave';

export const SHIFT_PRESETS: Record<string, ShiftCode[]> = {
  '3-2': ['day', 'mid', 'night', 'off'],
  '4-3': ['day', 'mid', 'night', 'off', 'off', 'off'],
  '3-3-8': ['day', 'mid', 'night', 'off', 'day', 'mid', 'night', 'off'],
};

export const SHIFT_CYCLE: ShiftCode[] = ['day', 'mid', 'night', 'off'];

export const HOLIDAYS_2026: Array<[string, string]> = [
  ['2026-01-01', '元旦'],
  ['2026-01-02', '元旦调休'],
  ['2026-02-15', '除夕'],
  ['2026-02-16', '春节'],
  ['2026-02-17', '春节'],
  ['2026-02-18', '春节'],
  ['2026-02-19', '春节'],
  ['2026-02-20', '春节'],
  ['2026-02-21', '春节'],
  ['2026-02-22', '春节调休'],
  ['2026-02-23', '春节调休'],
  ['2026-04-04', '清明'],
  ['2026-04-05', '清明'],
  ['2026-04-06', '清明'],
  ['2026-05-01', '劳动节'],
  ['2026-05-02', '劳动节'],
  ['2026-05-03', '劳动节'],
  ['2026-05-04', '劳动节'],
  ['2026-05-05', '劳动节'],
  ['2026-06-19', '端午'],
  ['2026-06-20', '端午'],
  ['2026-06-21', '端午'],
  ['2026-09-25', '中秋'],
  ['2026-09-26', '中秋'],
  ['2026-09-27', '中秋'],
  ['2026-10-01', '国庆'],
  ['2026-10-02', '国庆'],
  ['2026-10-03', '国庆'],
  ['2026-10-04', '国庆'],
  ['2026-10-05', '国庆'],
  ['2026-10-06', '国庆'],
  ['2026-10-07', '国庆'],
];

function fmtDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function addDays(s: string, n: number): string {
  const d = parseDateOnly(s);
  d.setDate(d.getDate() + n);
  return fmtDate(d);
}

function asSequence(raw: unknown): ShiftCode[] {
  if (!Array.isArray(raw) || raw.length === 0) return [...SHIFT_PRESETS['3-2']];
  return raw.filter((x): x is ShiftCode =>
    typeof x === 'string' && ['day', 'mid', 'night', 'off', 'leave'].includes(x),
  ) as ShiftCode[];
}

function dateRange(start: string, duration: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < duration; i++) out.push(addDays(start, i));
  return out;
}

function autoShift(seq: ShiftCode[], staffIndex: number, dayIndex: number, staffCount: number): ShiftCode {
  const L = Math.max(1, seq.length);
  const M = Math.max(1, staffCount);
  const offset = Math.round((staffIndex * L) / M);
  return seq[(dayIndex + offset) % L];
}

async function loadBoard(prisma: PrismaClient, boardId: number) {
  return prisma.agent_shift_boards.findUnique({
    where: { id: boardId },
    include: {
      staff: { orderBy: [{ sort_order: 'asc' }, { id: 'asc' }] },
      leaves: { orderBy: { id: 'desc' } },
      manuals: true,
      notes: { orderBy: { date: 'asc' } },
    },
  });
}

function buildPayload(board: NonNullable<Awaited<ReturnType<typeof loadBoard>>>) {
  const seq = asSequence(board.sequence);
  const start = fmtDate(board.start_date);
  const dates = dateRange(start, board.duration);
  const staffNames = board.staff.map((s) => s.name);
  const leaveSet = new Set<string>();
  for (const l of board.leaves) {
    let d = fmtDate(l.from_date);
    const to = fmtDate(l.to_date);
    while (d <= to) {
      leaveSet.add(`${l.staff_name}|${d}`);
      d = addDays(d, 1);
    }
  }
  const manualMap = new Map(board.manuals.map((m) => [`${m.staff_name}|${fmtDate(m.date)}`, m.shift as ShiftCode]));
  const notesMap: Record<string, string> = {};
  for (const n of board.notes) notesMap[fmtDate(n.date)] = n.text;

  const grid = staffNames.map((name, si) => {
    const cells = dates.map((date, di) => {
      if (leaveSet.has(`${name}|${date}`)) {
        return { date, shift: 'leave' as ShiftCode, manual: false, warn: false };
      }
      const man = manualMap.get(`${name}|${date}`);
      if (man) return { date, shift: man, manual: true, warn: false };
      return { date, shift: autoShift(seq, si, di, staffNames.length), manual: false, warn: false };
    });
    // consecutive work warn
    let run = 0;
    cells.forEach((c, di) => {
      if (c.shift !== 'off' && c.shift !== 'leave') {
        run += 1;
        if (run >= 7) {
          for (let k = 0; k < run; k++) cells[di - k].warn = true;
        }
      } else run = 0;
    });
    const workCount = cells.filter((c) => c.shift !== 'off' && c.shift !== 'leave').length;
    return { name, cells, work_count: workCount };
  });

  const daily = dates.map((date, di) => {
    let day = 0;
    let mid = 0;
    let night = 0;
    for (const row of grid) {
      const sh = row.cells[di]?.shift;
      if (sh === 'day') day++;
      if (sh === 'mid') mid++;
      if (sh === 'night') night++;
    }
    return { date, day, mid, night };
  });

  let hours = 0;
  let nights = 0;
  for (const row of grid) {
    for (const c of row.cells) {
      if (c.shift === 'day' || c.shift === 'mid' || c.shift === 'night') {
        hours += board.hours_per_shift;
      }
      if (c.shift === 'night') nights += 1;
    }
  }
  const pay = hours * board.hourly_rate + nights * board.night_bonus;

  return {
    board: {
      id: board.id,
      account_id: board.account_id,
      name: board.name,
      rhythm: board.rhythm,
      sequence: seq,
      start_date: start,
      duration: board.duration,
      need_per_shift: board.need_per_shift,
      time_day: board.time_day,
      time_mid: board.time_mid,
      time_night: board.time_night,
      hours_per_shift: board.hours_per_shift,
      hourly_rate: board.hourly_rate,
      night_bonus: board.night_bonus,
      theme: board.theme,
    },
    staff: board.staff.map((s) => ({ id: s.id, name: s.name, sort_order: s.sort_order })),
    leaves: board.leaves.map((l) => ({
      id: l.id,
      staff_name: l.staff_name,
      from_date: fmtDate(l.from_date),
      to_date: fmtDate(l.to_date),
      type: l.type,
    })),
    notes: notesMap,
    dates,
    grid,
    daily,
    stats: {
      staff_count: staffNames.length,
      total_hours: hours,
      night_count: nights,
      night_bonus_total: nights * board.night_bonus,
      estimated_pay: Math.round(pay),
    },
  };
}

export async function getOrCreateBoard(
  prisma: PrismaClient,
  opts: { accountId: number; userId: number },
) {
  let board = await prisma.agent_shift_boards.findFirst({
    where: { account_id: opts.accountId },
    orderBy: { id: 'asc' },
  });
  if (!board) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    board = await prisma.agent_shift_boards.create({
      data: {
        account_id: opts.accountId,
        owner_id: opts.userId,
        start_date: today,
        staff: {
          create: ['坐席甲', '坐席乙', '坐席丙', '坐席丁', '坐席戊', '坐席己'].map((name, i) => ({
            name,
            sort_order: i,
          })),
        },
      },
    });
  }
  const full = await loadBoard(prisma, board.id);
  if (!full) throw new Error('board missing');
  return buildPayload(full);
}

export async function patchBoardSettings(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    body: {
      name?: string;
      rhythm?: string;
      sequence?: string[];
      start_date?: string;
      duration?: number;
      need_per_shift?: number;
      time_day?: string;
      time_mid?: string;
      time_night?: string;
      hours_per_shift?: number;
      hourly_rate?: number;
      night_bonus?: number;
      theme?: string;
      clear_manuals?: boolean;
    };
  },
) {
  const board = await prisma.agent_shift_boards.findFirst({
    where: { account_id: opts.accountId },
  });
  if (!board) return null;

  let sequence = asSequence(board.sequence);
  if (opts.body.rhythm && SHIFT_PRESETS[opts.body.rhythm]) {
    sequence = [...SHIFT_PRESETS[opts.body.rhythm]];
  }
  if (opts.body.sequence) sequence = asSequence(opts.body.sequence);

  await prisma.agent_shift_boards.update({
    where: { id: board.id },
    data: {
      ...(opts.body.name !== undefined && { name: opts.body.name }),
      ...(opts.body.rhythm !== undefined && { rhythm: opts.body.rhythm }),
      sequence,
      ...(opts.body.start_date && { start_date: parseDateOnly(opts.body.start_date) }),
      ...(opts.body.duration !== undefined && { duration: Math.min(90, Math.max(7, opts.body.duration)) }),
      ...(opts.body.need_per_shift !== undefined && {
        need_per_shift: Math.max(1, opts.body.need_per_shift),
      }),
      ...(opts.body.time_day !== undefined && { time_day: opts.body.time_day }),
      ...(opts.body.time_mid !== undefined && { time_mid: opts.body.time_mid }),
      ...(opts.body.time_night !== undefined && { time_night: opts.body.time_night }),
      ...(opts.body.hours_per_shift !== undefined && { hours_per_shift: opts.body.hours_per_shift }),
      ...(opts.body.hourly_rate !== undefined && { hourly_rate: opts.body.hourly_rate }),
      ...(opts.body.night_bonus !== undefined && { night_bonus: opts.body.night_bonus }),
      ...(opts.body.theme !== undefined && { theme: opts.body.theme }),
    },
  });

  if (opts.body.clear_manuals) {
    await prisma.agent_shift_manuals.deleteMany({ where: { board_id: board.id } });
  }

  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function addStaff(
  prisma: PrismaClient,
  opts: { accountId: number; name: string },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  const name = opts.name.trim();
  if (!name) return null;
  const exists = await prisma.agent_shift_staff.findFirst({
    where: { board_id: board.id, name },
  });
  if (exists) return { error: 'duplicate' as const };
  const maxSort = await prisma.agent_shift_staff.aggregate({
    where: { board_id: board.id },
    _max: { sort_order: true },
  });
  await prisma.agent_shift_staff.create({
    data: {
      board_id: board.id,
      name,
      sort_order: (maxSort._max.sort_order ?? -1) + 1,
    },
  });
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function removeStaff(
  prisma: PrismaClient,
  opts: { accountId: number; staffId: number },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  const row = await prisma.agent_shift_staff.findFirst({
    where: { id: opts.staffId, board_id: board.id },
  });
  if (!row) return null;
  await prisma.$transaction([
    prisma.agent_shift_manuals.deleteMany({ where: { board_id: board.id, staff_name: row.name } }),
    prisma.agent_shift_leaves.deleteMany({ where: { board_id: board.id, staff_name: row.name } }),
    prisma.agent_shift_staff.delete({ where: { id: row.id } }),
  ]);
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function addLeave(
  prisma: PrismaClient,
  opts: {
    accountId: number;
    staff_name: string;
    from_date: string;
    to_date: string;
    type?: string;
  },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  if (opts.to_date < opts.from_date) return { error: 'range' as const };
  await prisma.agent_shift_leaves.create({
    data: {
      board_id: board.id,
      staff_name: opts.staff_name,
      from_date: parseDateOnly(opts.from_date),
      to_date: parseDateOnly(opts.to_date),
      type: opts.type || 'leave',
    },
  });
  // clear manuals overlapping leave
  let d = opts.from_date;
  while (d <= opts.to_date) {
    await prisma.agent_shift_manuals.deleteMany({
      where: { board_id: board.id, staff_name: opts.staff_name, date: parseDateOnly(d) },
    });
    d = addDays(d, 1);
  }
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function removeLeave(
  prisma: PrismaClient,
  opts: { accountId: number; leaveId: number },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  await prisma.agent_shift_leaves.deleteMany({ where: { id: opts.leaveId, board_id: board.id } });
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function cycleCell(
  prisma: PrismaClient,
  opts: { accountId: number; staff_name: string; date: string },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  const full0 = await loadBoard(prisma, board.id);
  if (!full0) return null;
  const payload = buildPayload(full0);
  const row = payload.grid.find((g) => g.name === opts.staff_name);
  const cell = row?.cells.find((c) => c.date === opts.date);
  if (!cell) return null;
  if (cell.shift === 'leave') return { error: 'on_leave' as const };

  const si = payload.staff.findIndex((s) => s.name === opts.staff_name);
  const di = payload.dates.indexOf(opts.date);
  const seq = asSequence(board.sequence);
  const base = autoShift(seq, si, di, payload.staff.length);
  const cur = cell.manual ? cell.shift : base;
  let idx = SHIFT_CYCLE.indexOf(cur as ShiftCode);
  if (idx < 0) idx = 0;
  const next = SHIFT_CYCLE[(idx + 1) % SHIFT_CYCLE.length];

  if (next === base) {
    await prisma.agent_shift_manuals.deleteMany({
      where: {
        board_id: board.id,
        staff_name: opts.staff_name,
        date: parseDateOnly(opts.date),
      },
    });
  } else {
    await prisma.agent_shift_manuals.upsert({
      where: {
        board_id_staff_name_date: {
          board_id: board.id,
          staff_name: opts.staff_name,
          date: parseDateOnly(opts.date),
        },
      },
      create: {
        board_id: board.id,
        staff_name: opts.staff_name,
        date: parseDateOnly(opts.date),
        shift: next,
      },
      update: { shift: next },
    });
  }
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function upsertNote(
  prisma: PrismaClient,
  opts: { accountId: number; date: string; text: string },
) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  const text = opts.text.trim();
  if (!text) {
    await prisma.agent_shift_notes.deleteMany({
      where: { board_id: board.id, date: parseDateOnly(opts.date) },
    });
  } else {
    await prisma.agent_shift_notes.upsert({
      where: {
        board_id_date: { board_id: board.id, date: parseDateOnly(opts.date) },
      },
      create: { board_id: board.id, date: parseDateOnly(opts.date), text },
      update: { text },
    });
  }
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export async function deleteNote(
  prisma: PrismaClient,
  opts: { accountId: number; date: string },
) {
  return upsertNote(prisma, { accountId: opts.accountId, date: opts.date, text: '' });
}

export async function fillHolidays2026(prisma: PrismaClient, opts: { accountId: number }) {
  const board = await prisma.agent_shift_boards.findFirst({ where: { account_id: opts.accountId } });
  if (!board) return null;
  for (const [date, text] of HOLIDAYS_2026) {
    await prisma.agent_shift_notes.upsert({
      where: {
        board_id_date: { board_id: board.id, date: parseDateOnly(date) },
      },
      create: { board_id: board.id, date: parseDateOnly(date), text },
      update: { text },
    });
  }
  const full = await loadBoard(prisma, board.id);
  return full ? buildPayload(full) : null;
}

export function boardToCsv(payload: ReturnType<typeof buildPayload>): string {
  const label: Record<string, string> = {
    day: '早',
    mid: '中',
    night: '夜',
    off: '休',
    leave: '假',
  };
  const header = ['坐席', ...payload.dates, '合计班次'];
  const rows = [header];
  for (const g of payload.grid) {
    rows.push([
      g.name,
      ...g.cells.map((c) => label[c.shift] || c.shift),
      String(g.work_count),
    ]);
  }
  const bom = '\uFEFF';
  return (
    bom +
    rows.map((r) => r.map((x) => `"${String(x).replace(/"/g, '""')}"`).join(',')).join('\n')
  );
}
