import { RecurringCadence } from '@prisma/client';

/**
 * Cadence conversion happens once, here, so no client has to know that a weekly
 * expense is 4.348 months' worth. 30.44 and 4.348 are the average month and
 * week in a year, not 30 and 4.
 */
const MONTHLY_FACTOR: Record<RecurringCadence, number> = {
  DAILY: 30.44,
  WEEKLY: 4.348,
  MONTHLY: 1,
  YEARLY: 1 / 12,
};

export function toMonthly(amount: number, cadence: RecurringCadence): number {
  return round2(amount * MONTHLY_FACTOR[cadence]);
}

export function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Start of the month `back` months before the month containing `now`. */
export function monthStart(now: Date, back = 0): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - back, 1, 0, 0, 0, 0));
}

/**
 * The last N complete calendar months, never including the current partial one
 * — a month that is three days old would drag every average down.
 */
export function historyWindow(now: Date, months = 3): { from: Date; to: Date } {
  const to = new Date(monthStart(now).getTime() - 1);
  const from = monthStart(now, months);

  return { from, to };
}

/** The month keys covered by the window, oldest first: ["2026-05", …]. */
export function monthKeys(now: Date, months = 3): string[] {
  return Array.from({ length: months }, (_, i) =>
    monthStart(now, months - i).toISOString().slice(0, 7),
  );
}

/** Whole calendar months between two dates, at least 1 and at most `cap`. */
export function completeMonthsBetween(first: Date, now: Date, cap = 3): number {
  const months =
    (now.getUTCFullYear() - first.getUTCFullYear()) * 12 +
    (now.getUTCMonth() - first.getUTCMonth());

  return Math.max(1, Math.min(cap, months));
}

export function median(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? round2((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/**
 * Categories the planner never suggests cutting. Rent, EMI and bills are not
 * choices, and Investments is money leaving the account that it would be
 * perverse to call a saving.
 */
export const UNSUGGESTABLE = new Set(
  ['bills', 'emi', 'loan', 'rent', 'investments', 'investment', 'insurance'].map((c) => c),
);

export function isSuggestable(category: string): boolean {
  return !UNSUGGESTABLE.has(category.trim().toLowerCase());
}
