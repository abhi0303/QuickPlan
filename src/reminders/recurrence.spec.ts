import { leadTime, nextOccurrence } from './recurrence';

const at = (iso: string) => new Date(iso);

describe('nextOccurrence', () => {
  it('returns null for a one-off reminder', () => {
    expect(nextOccurrence(at('2026-08-21T10:00:00Z'), null, at('2026-08-21T10:00:00Z'))).toBeNull();
  });

  it('advances daily keeping the time of day', () => {
    const next = nextOccurrence(at('2026-08-21T10:00:00Z'), 'DAILY', at('2026-08-21T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-22T10:00:00.000Z');
  });

  it('skips the weekend for WEEKDAYS', () => {
    // 2026-08-21 is a Friday, so the next weekday is Monday the 24th.
    const next = nextOccurrence(at('2026-08-21T10:00:00Z'), 'WEEKDAYS', at('2026-08-21T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-24T10:00:00.000Z');
  });

  it('advances weekly', () => {
    const next = nextOccurrence(at('2026-08-21T10:00:00Z'), 'WEEKLY', at('2026-08-21T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-28T10:00:00.000Z');
  });

  it('clamps a month-end date instead of rolling into the next month', () => {
    // Naive month addition turns 31 Jan into 2 or 3 March.
    const next = nextOccurrence(at('2026-01-31T10:00:00Z'), 'MONTHLY', at('2026-01-31T10:00:00Z'));
    expect(next?.toISOString()).toBe('2026-02-28T10:00:00.000Z');
  });

  it('skips past missed occurrences after downtime rather than replaying them', () => {
    const next = nextOccurrence(at('2026-08-01T10:00:00Z'), 'DAILY', at('2026-08-21T09:00:00Z'));
    expect(next?.toISOString()).toBe('2026-08-21T10:00:00.000Z');
  });

  it('ignores an unrecognised rule', () => {
    expect(nextOccurrence(at('2026-08-21T10:00:00Z'), 'HOURLY', at('2026-08-21T10:00:00Z'))).toBeNull();
  });
});

describe('leadTime', () => {
  it('subtracts the offset from the due moment', () => {
    expect(leadTime(at('2026-08-21T10:00:00Z'), 30).toISOString()).toBe('2026-08-21T09:30:00.000Z');
  });

  it('is the due moment itself when there is no offset', () => {
    expect(leadTime(at('2026-08-21T10:00:00Z'), 0).toISOString()).toBe('2026-08-21T10:00:00.000Z');
  });
});
