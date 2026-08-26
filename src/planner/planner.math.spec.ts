import { RecurringCadence } from '@prisma/client';
import {
  completeMonthsBetween,
  historyWindow,
  isSuggestable,
  median,
  toMonthly,
} from './planner.math';

describe('toMonthly', () => {
  /** The acceptance rows, exactly. */
  it('converts a weekly schedule using the real average week', () => {
    expect(toMonthly(500, RecurringCadence.WEEKLY)).toBe(2174);
  });

  it('converts a yearly schedule', () => {
    expect(toMonthly(12000, RecurringCadence.YEARLY)).toBe(1000);
  });

  it('leaves a monthly schedule alone', () => {
    expect(toMonthly(18000, RecurringCadence.MONTHLY)).toBe(18000);
  });

  it('uses the average month for a daily schedule, not 30', () => {
    expect(toMonthly(100, RecurringCadence.DAILY)).toBe(3044);
  });
});

describe('historyWindow', () => {
  it('ends before the current month, never including a partial one', () => {
    const w = historyWindow(new Date('2026-08-26T10:00:00Z'), 3);

    expect(w.from.toISOString().slice(0, 10)).toBe('2026-05-01');
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-07-31');
  });

  it('spans a year boundary', () => {
    const w = historyWindow(new Date('2026-02-10T10:00:00Z'), 3);

    expect(w.from.toISOString().slice(0, 10)).toBe('2025-11-01');
    expect(w.to.toISOString().slice(0, 10)).toBe('2026-01-31');
  });
});

describe('completeMonthsBetween', () => {
  it('caps at three', () => {
    expect(completeMonthsBetween(new Date('2025-01-01'), new Date('2026-08-26'), 3)).toBe(3);
  });

  /** Do not silently divide by three when there is less history than that. */
  it('reports what actually exists', () => {
    expect(completeMonthsBetween(new Date('2026-07-05'), new Date('2026-08-26'), 3)).toBe(1);
    expect(completeMonthsBetween(new Date('2026-06-05'), new Date('2026-08-26'), 3)).toBe(2);
  });

  it('never returns zero, so an average cannot divide by it', () => {
    expect(completeMonthsBetween(new Date('2026-08-20'), new Date('2026-08-26'), 3)).toBe(1);
  });
});

describe('median', () => {
  it('takes the middle of an odd set', () => {
    expect(median([7500, 9600, 6200])).toBe(7500);
  });

  it('averages the middle two of an even set', () => {
    expect(median([100, 200, 300, 400])).toBe(250);
  });

  it('is zero for no data', () => {
    expect(median([])).toBe(0);
  });
});

describe('isSuggestable', () => {
  it.each(['Rent', 'EMI', 'Loan', 'Bills', 'Investments'])(
    'never suggests cutting %s',
    (category) => {
      expect(isSuggestable(category)).toBe(false);
    },
  );

  it('ignores case and padding', () => {
    expect(isSuggestable('  rent ')).toBe(false);
  });

  it('allows discretionary categories', () => {
    expect(isSuggestable('Food')).toBe(true);
    expect(isSuggestable('Shopping')).toBe(true);
  });
});
