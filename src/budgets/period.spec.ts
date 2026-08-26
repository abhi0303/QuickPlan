import { BudgetPeriod, BudgetStatus } from '@prisma/client';
import { daysInMonth, periodKey, project, resolveWindow, statusFor } from './period';

describe('resolveWindow (monthly)', () => {
  it('spans the whole month', () => {
    const w = resolveWindow('2026-08', BudgetPeriod.MONTHLY, new Date('2026-08-25T12:00:00Z'));

    expect(w.key).toBe('2026-08');
    expect(w.from.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-08-31T23:59:59.999Z');
    expect(w.daysTotal).toBe(31);
  });

  it('counts day one as elapsed, so a projection never divides by zero', () => {
    const w = resolveWindow('2026-08', BudgetPeriod.MONTHLY, new Date('2026-08-01T00:30:00Z'));

    expect(w.daysElapsed).toBe(1);
    expect(project(100, w)).toBe(3100);
  });

  it('reports a finished month at its full length', () => {
    const w = resolveWindow('2026-07', BudgetPeriod.MONTHLY, new Date('2026-08-25T12:00:00Z'));

    expect(w.daysElapsed).toBe(31);
    expect(w.daysTotal).toBe(31);
  });

  it('reports a future month as not started', () => {
    const w = resolveWindow('2026-12', BudgetPeriod.MONTHLY, new Date('2026-08-25T12:00:00Z'));

    expect(w.daysElapsed).toBe(0);
    expect(project(500, w)).toBe(0);
  });

  it('knows February', () => {
    expect(daysInMonth(2026, 1)).toBe(28);
    expect(daysInMonth(2028, 1)).toBe(29);
  });
});

describe('project', () => {
  /** The acceptance case: 2,100 of 8,000 on the 9th. */
  it('projects the run rate to the end of the period', () => {
    const w = resolveWindow('2026-08', BudgetPeriod.MONTHLY, new Date('2026-08-09T12:00:00Z'));

    expect(w.daysElapsed).toBe(9);
    expect(project(2100, w)).toBeCloseTo(7233.33, 1);
  });

  it('matches the worked example from the spec', () => {
    const w = resolveWindow('2026-08', BudgetPeriod.MONTHLY, new Date('2026-08-25T12:00:00Z'));

    expect(w.daysElapsed).toBe(25);
    expect(project(22400, w)).toBe(27776);
    expect(project(6280, w)).toBeCloseTo(7787.2, 1);
    expect(project(3480, w)).toBeCloseTo(4315.2, 1);
  });
});

describe('statusFor', () => {
  it.each([
    [0, BudgetStatus.ON_TRACK],
    [26.25, BudgetStatus.ON_TRACK],
    [79.99, BudgetStatus.ON_TRACK],
    [80, BudgetStatus.WARNING],
    [100, BudgetStatus.WARNING],
    [100.01, BudgetStatus.EXCEEDED],
    [116, BudgetStatus.EXCEEDED],
  ])('%s%% is %s', (percentage, expected) => {
    expect(statusFor(percentage)).toBe(expected);
  });
});

describe('weekly periods', () => {
  it('runs Monday to Sunday', () => {
    // 2026-08-26 is a Wednesday.
    const w = resolveWindow(undefined, BudgetPeriod.WEEKLY, new Date('2026-08-26T12:00:00Z'));

    expect(w.from.getUTCDay()).toBe(1);
    expect(w.daysTotal).toBe(7);
    expect(w.daysElapsed).toBe(3);
  });

  it('keys a week so it does not change midway through a weekend', () => {
    const saturday = periodKey(new Date('2026-08-29T12:00:00Z'), BudgetPeriod.WEEKLY);
    const sunday = periodKey(new Date('2026-08-30T12:00:00Z'), BudgetPeriod.WEEKLY);

    expect(saturday).toBe(sunday);
    expect(saturday).toMatch(/^\d{4}-W\d{2}$/);
  });
});
