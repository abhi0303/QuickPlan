/**
 * iCalendar (RFC 5545) serialisation for a reminder.
 *
 * The rules here are the usual reasons a file imports as nothing at all: CRLF
 * endings, escaped text, and folding at 75 octets rather than 75 characters.
 */

const DEFAULT_DURATION_MINUTES = 15;
const MAX_OCTETS = 75;

export interface ReminderForIcs {
  id: string;
  title: string;
  dueAt: Date;
  offsetMinutes: number;
  recurrenceRule: string | null;
  sequence: number;
}

/** `\` `;` `,` and newlines all carry meaning in a property value. */
export function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    // '\;' in a JS string literal is just ';' - the escape has to be escaped.
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');
}

/**
 * Folds to 75 octets per line, continuing with a leading space. Measured in
 * octets, not characters, and never split mid-codepoint - an emoji or Devanagari
 * title would otherwise be cut in half and the file rejected.
 */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, 'utf8');

  if (bytes.length <= MAX_OCTETS) {
    return line;
  }

  const pieces: string[] = [];
  let start = 0;
  // First line takes 75 octets; continuations take 74, since the leading space
  // counts toward the limit.
  let budget = MAX_OCTETS;

  while (start < bytes.length) {
    let end = Math.min(start + budget, bytes.length);

    // Walk back off a continuation byte so a multi-byte character stays whole.
    while (end > start && end < bytes.length && (bytes[end] & 0xc0) === 0x80) {
      end--;
    }

    pieces.push(bytes.subarray(start, end).toString('utf8'));
    start = end;
    budget = MAX_OCTETS - 1;
  }

  return pieces[0] + pieces.slice(1).map((piece) => `\r\n ${piece}`).join('');
}

/** `20260827T081500Z` - UTC throughout, so no VTIMEZONE is needed. */
export function formatUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function toRrule(recurrenceRule: string | null): string | null {
  switch (recurrenceRule?.trim().toUpperCase()) {
    case 'DAILY':
      return 'FREQ=DAILY';
    case 'WEEKLY':
      return 'FREQ=WEEKLY';
    case 'MONTHLY':
      return 'FREQ=MONTHLY';
    case 'WEEKDAYS':
      return 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR';
    default:
      return null;
  }
}

/** A negative offset alarm, or one exactly at the start when there is none. */
export function toTrigger(offsetMinutes: number): string {
  return offsetMinutes > 0 ? `-PT${offsetMinutes}M` : 'PT0M';
}

/** Cosmetic, but a sensible filename helps people find the download. */
export function icsFilename(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);

  return `${slug || 'reminder'}.ics`;
}

export function buildIcs(reminder: ReminderForIcs, now = new Date()): string {
  const start = reminder.dueAt;
  const end = new Date(start.getTime() + DEFAULT_DURATION_MINUTES * 60 * 1000);
  const summary = escapeText(reminder.title);
  const rrule = toRrule(reminder.recurrenceRule);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//QuickPlan//Reminders//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable, so re-adding the same reminder updates the event rather than
    // creating a second one.
    `UID:${reminder.id}@quickplan.app`,
    `DTSTAMP:${formatUtc(now)}`,
    `DTSTART:${formatUtc(start)}`,
    // A reminder is a point in time, but several clients reject an event with
    // neither DTEND nor DURATION.
    `DTEND:${formatUtc(end)}`,
    `SUMMARY:${summary}`,
    'DESCRIPTION:Reminder from QuickPlan',
    ...(rrule ? [`RRULE:${rrule}`] : []),
    'STATUS:CONFIRMED',
    'TRANSP:TRANSPARENT',
    `SEQUENCE:${reminder.sequence}`,
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${summary}`,
    `TRIGGER:${toTrigger(reminder.offsetMinutes)}`,
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  // CRLF throughout, including a trailing one after the final line.
  return lines.map(foldLine).join('\r\n') + '\r\n';
}
