import { RecurringCadence } from '@prisma/client';
import { firstRun, nextRun, runKey } from './cadence';

const at = (iso: string) => new Date(iso);

describe('nextRun (monthly)', () => {
  /** The acceptance case: rent on the 31st must not skip February. */
  it('clamps the 31st to the last day of a shorter month', () => {
    const next = nextRun(at('2026-01-31T09:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 31 });

    expect(next.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('clamps to 29 in a leap February', () => {
    const next = nextRun(at('2028-01-31T09:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 31 });

    expect(next.toISOString().slice(0, 10)).toBe('2028-02-29');
  });

  it('returns to the requested day once the month is long enough', () => {
    const next = nextRun(at('2026-02-28T09:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 31 });

    expect(next.toISOString().slice(0, 10)).toBe('2026-03-31');
  });

  it('advances a normal month', () => {
    const next = nextRun(at('2026-08-05T09:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 5 });

    expect(next.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('rolls across a year boundary', () => {
    const next = nextRun(at('2026-12-15T09:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 15 });

    expect(next.toISOString().slice(0, 10)).toBe('2027-01-15');
  });
});

describe('nextRun (other cadences)', () => {
  it('advances a day', () => {
    expect(nextRun(at('2026-08-25T09:00:00Z'), RecurringCadence.DAILY).toISOString().slice(0, 10))
      .toBe('2026-08-26');
  });

  it('advances a full week, not zero days, on the same weekday', () => {
    const next = nextRun(at('2026-08-25T09:00:00Z'), RecurringCadence.WEEKLY, { weekday: 2 });

    expect(next.toISOString().slice(0, 10)).toBe('2026-09-01');
  });

  it('advances a year', () => {
    expect(nextRun(at('2026-08-25T09:00:00Z'), RecurringCadence.YEARLY).toISOString().slice(0, 4))
      .toBe('2027');
  });
});

describe('runKey', () => {
  it.each([
    [RecurringCadence.DAILY, '2026-08-25'],
    [RecurringCadence.MONTHLY, '2026-08'],
    [RecurringCadence.YEARLY, '2026'],
  ])('keys %s as %s', (cadence, expected) => {
    expect(runKey(at('2026-08-25T09:00:00Z'), cadence)).toBe(expected);
  });

  it('keys a week by its Monday, so every day in it agrees', () => {
    const keys = ['2026-08-24', '2026-08-27', '2026-08-30'].map((d) =>
      runKey(at(`${d}T09:00:00Z`), RecurringCadence.WEEKLY),
    );

    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('2026-08-24');
  });

  it('gives different periods different keys, so each one runs once', () => {
    expect(runKey(at('2026-08-31T09:00:00Z'), RecurringCadence.MONTHLY)).not.toBe(
      runKey(at('2026-09-01T09:00:00Z'), RecurringCadence.MONTHLY),
    );
  });
});

describe('firstRun', () => {
  it('uses this month when the day is still ahead', () => {
    const first = firstRun(at('2026-08-05T00:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 20 });

    expect(first.toISOString().slice(0, 10)).toBe('2026-08-20');
  });

  it('rolls to next month when the day has passed', () => {
    const first = firstRun(at('2026-08-25T00:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 5 });

    expect(first.toISOString().slice(0, 10)).toBe('2026-09-05');
  });

  it('clamps a first run of the 31st in a short month', () => {
    const first = firstRun(at('2026-02-01T00:00:00Z'), RecurringCadence.MONTHLY, { dayOfMonth: 31 });

    expect(first.toISOString().slice(0, 10)).toBe('2026-02-28');
  });
});
