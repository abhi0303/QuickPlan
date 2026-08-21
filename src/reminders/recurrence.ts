export type RecurrenceRule = 'DAILY' | 'WEEKDAYS' | 'WEEKLY' | 'MONTHLY';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Next occurrence strictly after `from`, keeping the original time of day.
 * Everything is UTC: dueAt is stored in UTC and the frontend sends ISO strings,
 * so applying a server-local offset here would shift reminders for every user
 * whose server happens to move.
 */
export function nextOccurrence(current: Date, rule: string | null, from: Date): Date | null {
  if (!rule) {
    return null;
  }

  const normalised = rule.trim().toUpperCase() as RecurrenceRule;
  let next = new Date(current.getTime());

  // Step forward until we pass `from`, so a scheduler that was down for days
  // resumes at the next real occurrence rather than replaying every missed one.
  const guard = 1000;
  let iterations = 0;

  while (next.getTime() <= from.getTime() && iterations < guard) {
    switch (normalised) {
      case 'DAILY':
        next = new Date(next.getTime() + DAY_MS);
        break;

      case 'WEEKDAYS':
        do {
          next = new Date(next.getTime() + DAY_MS);
        } while (next.getUTCDay() === 0 || next.getUTCDay() === 6);
        break;

      case 'WEEKLY':
        next = new Date(next.getTime() + 7 * DAY_MS);
        break;

      case 'MONTHLY': {
        const candidate = new Date(next.getTime());
        const targetDay = candidate.getUTCDate();
        candidate.setUTCMonth(candidate.getUTCMonth() + 1);

        // setUTCMonth rolls over when the target month is shorter - the 31st
        // becoming the 1st or 2nd. Clamp to the last day of the month instead.
        if (candidate.getUTCDate() !== targetDay) {
          candidate.setUTCDate(0);
        }

        next = candidate;
        break;
      }

      default:
        return null;
    }

    iterations++;
  }

  return next.getTime() > from.getTime() ? next : null;
}

export function leadTime(dueAt: Date, offsetMinutes: number): Date {
  return new Date(dueAt.getTime() - offsetMinutes * 60 * 1000);
}
