import { RecurringCadence } from '@prisma/client';
import { daysInMonth } from '../budgets/period';

/**
 * "2026-08-25" daily, "2026-W34" weekly, "2026-08" monthly, "2026" yearly.
 * Written alongside the generated expense so a second attempt at the same
 * period is a no-op.
 */
export function runKey(date: Date, cadence: RecurringCadence): string {
  const iso = date.toISOString();

  switch (cadence) {
    case RecurringCadence.DAILY:
      return iso.slice(0, 10);
    case RecurringCadence.WEEKLY: {
      const monday = new Date(date.getTime());
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));

      return `${monday.toISOString().slice(0, 10)}`;
    }
    case RecurringCadence.YEARLY:
      return iso.slice(0, 4);
    default:
      return iso.slice(0, 7);
  }
}

/**
 * Next occurrence strictly after `from`, keeping the time of day.
 *
 * Monthly clamps to the last day of a shorter month: rent set for the 31st
 * falls on the 28th in February rather than skipping the month entirely.
 */
export function nextRun(
  from: Date,
  cadence: RecurringCadence,
  options: { dayOfMonth?: number | null; weekday?: number | null } = {},
): Date {
  const next = new Date(from.getTime());

  switch (cadence) {
    case RecurringCadence.DAILY:
      next.setUTCDate(next.getUTCDate() + 1);

      return next;

    case RecurringCadence.WEEKLY: {
      const target = options.weekday ?? from.getUTCDay();
      let delta = (target - next.getUTCDay() + 7) % 7;

      // Same weekday means a full week away, not today.
      if (delta === 0) {
        delta = 7;
      }

      next.setUTCDate(next.getUTCDate() + delta);

      return next;
    }

    case RecurringCadence.YEARLY:
      next.setUTCFullYear(next.getUTCFullYear() + 1);

      return next;

    default: {
      const day = options.dayOfMonth ?? from.getUTCDate();
      const year = next.getUTCFullYear();
      const month = next.getUTCMonth() + 1;
      const target = new Date(
        Date.UTC(
          year,
          month,
          Math.min(day, daysInMonth(month === 12 ? year + 1 : year, month % 12)),
          next.getUTCHours(),
          next.getUTCMinutes(),
          0,
          0,
        ),
      );

      return target;
    }
  }
}

/** The first run at or after `from`, honouring dayOfMonth / weekday. */
export function firstRun(
  from: Date,
  cadence: RecurringCadence,
  options: { dayOfMonth?: number | null; weekday?: number | null } = {},
): Date {
  const start = new Date(from.getTime());
  start.setUTCHours(9, 0, 0, 0);

  if (cadence === RecurringCadence.MONTHLY && options.dayOfMonth) {
    const year = start.getUTCFullYear();
    const month = start.getUTCMonth();
    const day = Math.min(options.dayOfMonth, daysInMonth(year, month));
    const candidate = new Date(Date.UTC(year, month, day, 9, 0, 0, 0));

    return candidate >= from
      ? candidate
      : nextRun(candidate, cadence, options);
  }

  if (cadence === RecurringCadence.WEEKLY && options.weekday !== null && options.weekday !== undefined) {
    const delta = (options.weekday - start.getUTCDay() + 7) % 7;
    const candidate = new Date(start.getTime());
    candidate.setUTCDate(candidate.getUTCDate() + delta);

    return candidate >= from ? candidate : nextRun(candidate, cadence, options);
  }

  return start >= from ? start : nextRun(start, cadence, options);
}
