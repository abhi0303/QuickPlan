import { BudgetPeriod, BudgetStatus } from '@prisma/client';

/**
 * Period maths for budgets, all in UTC — the same basis every other date in the
 * app uses, so a budget window and an expense date cannot disagree.
 */

export interface PeriodWindow {
  key: string;
  from: Date;
  to: Date;
  daysTotal: number;
  daysElapsed: number;
}

export function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/** "2026-08" for monthly, "2026-W34" for weekly. */
export function periodKey(date: Date, period: BudgetPeriod): string {
  if (period === BudgetPeriod.WEEKLY) {
    const monday = startOfWeek(date);

    return `${monday.getUTCFullYear()}-W${String(isoWeek(monday)).padStart(2, '0')}`;
  }

  return date.toISOString().slice(0, 7);
}

export function startOfWeek(date: Date): Date {
  const copy = new Date(date.getTime());
  // Monday-first, so a week key does not change halfway through a weekend.
  const weekday = (copy.getUTCDay() + 6) % 7;

  copy.setUTCDate(copy.getUTCDate() - weekday);
  copy.setUTCHours(0, 0, 0, 0);

  return copy;
}

function isoWeek(monday: Date): number {
  const thursday = new Date(monday.getTime());
  thursday.setUTCDate(thursday.getUTCDate() + 3);

  const firstThursday = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const firstMonday = startOfWeek(firstThursday);

  return Math.round((thursday.getTime() - firstMonday.getTime()) / (7 * 86400000)) + 1;
}

/**
 * Resolves a period key into a window. `daysElapsed` is capped at the length of
 * the period, so a finished month projects from its full length rather than
 * running away.
 */
export function resolveWindow(
  key: string | undefined,
  period: BudgetPeriod,
  now = new Date(),
): PeriodWindow {
  if (period === BudgetPeriod.WEEKLY) {
    const anchor = key ? weekAnchor(key, now) : now;
    const from = startOfWeek(anchor);
    const to = new Date(from.getTime() + 7 * 86400000 - 1);

    return {
      key: periodKey(from, period),
      from,
      to,
      daysTotal: 7,
      daysElapsed: elapsedDays(from, to, 7, now),
    };
  }

  const [year, month] = key
    ? key.split('-').map(Number)
    : [now.getUTCFullYear(), now.getUTCMonth() + 1];

  const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const daysTotal = daysInMonth(year, month - 1);
  const to = new Date(Date.UTC(year, month - 1, daysTotal, 23, 59, 59, 999));

  return {
    key: `${year}-${String(month).padStart(2, '0')}`,
    from,
    to,
    daysTotal,
    daysElapsed: elapsedDays(from, to, daysTotal, now),
  };
}

function weekAnchor(key: string, fallback: Date): Date {
  const match = key.match(/^(\d{4})-W(\d{1,2})$/);

  if (!match) {
    return fallback;
  }

  const firstThursday = new Date(Date.UTC(Number(match[1]), 0, 4));
  const firstMonday = startOfWeek(firstThursday);

  return new Date(firstMonday.getTime() + (Number(match[2]) - 1) * 7 * 86400000);
}

function elapsedDays(from: Date, to: Date, daysTotal: number, now: Date): number {
  if (now < from) {
    return 0;
  }

  if (now > to) {
    return daysTotal;
  }

  // Day 1 counts as elapsed: on the 1st you have spent one day of the month,
  // otherwise the projection divides by zero.
  return Math.min(
    daysTotal,
    Math.floor((now.getTime() - from.getTime()) / 86400000) + 1,
  );
}

/**
 * Thresholds live here so the client cannot disagree with the server about
 * whether someone is over budget.
 */
export function statusFor(percentage: number): BudgetStatus {
  if (percentage > 100) {
    return BudgetStatus.EXCEEDED;
  }

  return percentage >= 80 ? BudgetStatus.WARNING : BudgetStatus.ON_TRACK;
}

/**
 * What the period ends at if spending carries on at this rate. It is the number
 * that makes a budget useful on the 9th, when "2,100 of 8,000" sounds fine and
 * is not.
 */
export function project(spent: number, window: PeriodWindow): number {
  if (window.daysElapsed <= 0) {
    return 0;
  }

  return round2((spent / window.daysElapsed) * window.daysTotal);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
