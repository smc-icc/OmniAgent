import type { FastifyRequest, FastifyReply } from 'fastify';
import { prisma } from '../../plugins/db.js';
import { NotFoundError, ValidationError } from '../../shared/errors/index.js';

/**
 * Working hours are per-inbox, one record per day of week (0=Sunday through 6=Saturday).
 *
 * Schema per record:
 *   day_of_week: number (0-6)
 *   open_hour: number (0-23)
 *   open_minutes: number (0-59)
 *   close_hour: number (0-23)
 *   close_minutes: number (0-59)
 *   closed_all_day: boolean
 *   open_all_day: boolean
 */

interface WorkingHourInput {
  day_of_week: number;
  open_hour?: number;
  open_minutes?: number;
  close_hour?: number;
  close_minutes?: number;
  closed_all_day?: boolean;
  open_all_day?: boolean;
}

function formatWorkingHour(w: Record<string, unknown>) {
  return {
    id: w.id,
    inbox_id: w.inbox_id,
    account_id: w.account_id,
    day_of_week: w.day_of_week,
    open_hour: w.open_hour,
    open_minutes: w.open_minutes,
    close_hour: w.close_hour,
    close_minutes: w.close_minutes,
    closed_all_day: w.closed_all_day,
    open_all_day: w.open_all_day,
  };
}

/** GET /api/v1/accounts/:account_id/inboxes/:inbox_id/working_hours */
export async function getWorkingHours(request: FastifyRequest, reply: FastifyReply) {
  const { inbox_id } = request.params as { inbox_id: string };

  const hours = await prisma.working_hours.findMany({
    where: { inbox_id: parseInt(inbox_id, 10) },
    orderBy: { day_of_week: 'asc' },
  });

  // Fill in missing days with default (open all day)
  const result: Record<number, Record<string, unknown>> = {};
  for (let d = 0; d < 7; d++) {
    const existing = hours.find((h) => h.day_of_week === d);
    result[d] = existing
      ? formatWorkingHour(existing as unknown as Record<string, unknown>)
      : {
          day_of_week: d,
          open_all_day: true,
          closed_all_day: false,
          open_hour: 0,
          open_minutes: 0,
          close_hour: 23,
          close_minutes: 59,
        };
  }

  return reply.status(200).send({ payload: result });
}

/** PUT /api/v1/accounts/:account_id/inboxes/:inbox_id/working_hours */
export async function updateWorkingHours(request: FastifyRequest, reply: FastifyReply) {
  const { account_id, inbox_id } = request.params as { account_id: string; inbox_id: string };
  const body = request.body as { working_hours?: WorkingHourInput[] };

  if (!body.working_hours?.length) {
    throw new ValidationError(['working_hours array is required']);
  }

  const accId = parseInt(account_id, 10);
  const inbId = parseInt(inbox_id, 10);

  // Verify inbox exists and belongs to account
  const inbox = await prisma.inboxes.findFirst({
    where: { id: inbId, account_id: accId },
  });
  if (!inbox) throw new NotFoundError('Inbox');

  // Delete existing working hours for this inbox
  await prisma.working_hours.deleteMany({ where: { inbox_id: inbId } });

  // Create new records
  const results = [];
  for (const wh of body.working_hours) {
    if (wh.day_of_week < 0 || wh.day_of_week > 6) {
      continue; // skip invalid days
    }

    const isOpenAllDay = wh.open_all_day === true;
    const isClosedAllDay = wh.closed_all_day === true;

    if (isOpenAllDay && isClosedAllDay) {
      continue; // mutually exclusive — skip
    }

    const hour = await prisma.working_hours.create({
      data: {
        account_id: accId,
        inbox_id: inbId,
        day_of_week: wh.day_of_week,
        open_hour: isOpenAllDay ? 0 : (wh.open_hour ?? 0),
        open_minutes: isOpenAllDay ? 0 : (wh.open_minutes ?? 0),
        close_hour: isOpenAllDay ? 23 : (wh.close_hour ?? 23),
        close_minutes: isOpenAllDay ? 59 : (wh.close_minutes ?? 59),
        closed_all_day: isClosedAllDay,
        open_all_day: isOpenAllDay,
      },
    });

    results.push(formatWorkingHour(hour as unknown as Record<string, unknown>));
  }

  return reply.status(200).send({ payload: results });
}
