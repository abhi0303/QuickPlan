import { buildIcs, escapeText, foldLine, formatUtc, icsFilename, toRrule, toTrigger } from './ics';

const base = {
  id: '9f2c1b7e-4d2a-4f1e-9c3a-77a1f0e5b911',
  title: 'Dentist appointment',
  dueAt: new Date('2026-08-27T08:15:00Z'),
  offsetMinutes: 15,
  recurrenceRule: null as string | null,
  sequence: 0,
};

const NOW = new Date('2026-08-25T08:15:00Z');
const lines = (ics: string) => ics.split('\r\n');
const find = (ics: string, prefix: string) => lines(ics).find((l) => l.startsWith(prefix));

describe('escapeText', () => {
  /** Our titles are free text, so an unescaped comma breaks the whole file. */
  it('escapes the characters that carry meaning in a property value', () => {
    expect(escapeText('Pay rent, then call Amit; urgent')).toBe(
      'Pay rent\\, then call Amit\\; urgent',
    );
    expect(escapeText('back\\slash')).toBe('back\\\\slash');
    expect(escapeText('two\nlines')).toBe('two\\nlines');
  });

  it('escapes the backslash before anything else', () => {
    expect(escapeText('a\\,b')).toBe('a\\\\\\,b');
  });
});

describe('foldLine', () => {
  it('leaves a short line alone', () => {
    expect(foldLine('SUMMARY:Short')).toBe('SUMMARY:Short');
  });

  it('folds at 75 octets with a leading space on continuations', () => {
    const folded = foldLine('SUMMARY:' + 'a'.repeat(200));
    const parts = folded.split('\r\n');

    expect(parts.length).toBeGreaterThan(1);
    expect(Buffer.from(parts[0], 'utf8').length).toBeLessThanOrEqual(75);
    parts.slice(1).forEach((part) => {
      expect(part.startsWith(' ')).toBe(true);
      expect(Buffer.from(part, 'utf8').length).toBeLessThanOrEqual(75);
    });
  });

  it('measures octets, not characters, and keeps multi-byte characters whole', () => {
    // Devanagari and emoji are 3 and 4 bytes; splitting one produces a file
    // no client will accept.
    const value = 'SUMMARY:' + 'नमस्ते 🎉 '.repeat(12);
    const folded = foldLine(value);

    folded.split('\r\n').forEach((part) => {
      expect(Buffer.from(part, 'utf8').length).toBeLessThanOrEqual(75);
    });
    // Unfolding restores the original exactly.
    expect(folded.split('\r\n').map((p, i) => (i ? p.slice(1) : p)).join('')).toBe(value);
  });
});

describe('formatUtc', () => {
  it('emits a UTC stamp with no punctuation', () => {
    expect(formatUtc(new Date('2026-08-27T08:15:00Z'))).toBe('20260827T081500Z');
  });
});

describe('toRrule', () => {
  it.each([
    ['DAILY', 'FREQ=DAILY'],
    ['WEEKLY', 'FREQ=WEEKLY'],
    ['MONTHLY', 'FREQ=MONTHLY'],
    ['WEEKDAYS', 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'],
  ])('maps %s', (rule, expected) => {
    expect(toRrule(rule)).toBe(expected);
  });

  it('returns nothing for an absent or unknown rule', () => {
    expect(toRrule(null)).toBeNull();
    expect(toRrule('HOURLY')).toBeNull();
  });
});

describe('toTrigger', () => {
  it('counts back from the start when there is an offset', () => {
    expect(toTrigger(15)).toBe('-PT15M');
  });

  it('fires at the start when the offset is zero', () => {
    expect(toTrigger(0)).toBe('PT0M');
  });
});

describe('buildIcs', () => {
  it('produces the expected skeleton', () => {
    const ics = buildIcs(base, NOW);

    expect(lines(ics)[0]).toBe('BEGIN:VCALENDAR');
    expect(find(ics, 'UID:')).toBe(`UID:${base.id}@quickplan.app`);
    expect(find(ics, 'DTSTAMP:')).toBe('DTSTAMP:20260825T081500Z');
    expect(find(ics, 'DTSTART:')).toBe('DTSTART:20260827T081500Z');
    expect(find(ics, 'SUMMARY:')).toBe('SUMMARY:Dentist appointment');
    expect(find(ics, 'TRIGGER:')).toBe('TRIGGER:-PT15M');
    expect(find(ics, 'SEQUENCE:')).toBe('SEQUENCE:0');
  });

  it('gives the event a 15 minute duration, since a bare instant is rejected', () => {
    const ics = buildIcs(base, NOW);

    expect(find(ics, 'DTEND:')).toBe('DTEND:20260827T083000Z');
  });

  it('uses CRLF throughout and ends with one', () => {
    const ics = buildIcs(base, NOW);

    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('omits RRULE entirely when the reminder does not repeat', () => {
    expect(buildIcs(base, NOW)).not.toContain('RRULE');
  });

  it('includes RRULE when it does', () => {
    const ics = buildIcs({ ...base, recurrenceRule: 'WEEKDAYS' }, NOW);

    expect(find(ics, 'RRULE:')).toBe('RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR');
  });

  it('carries the sequence so a re-import updates rather than duplicates', () => {
    const ics = buildIcs({ ...base, sequence: 3 }, NOW);

    expect(find(ics, 'SEQUENCE:')).toBe('SEQUENCE:3');
    expect(find(ics, 'UID:')).toBe(`UID:${base.id}@quickplan.app`);
  });

  it('escapes a title containing commas and semicolons', () => {
    const ics = buildIcs({ ...base, title: 'Pay rent, then call Amit; urgent' }, NOW);

    expect(find(ics, 'SUMMARY:')).toBe('SUMMARY:Pay rent\\, then call Amit\\; urgent');
  });

  it('keeps every line within 75 octets for a long non-ASCII title', () => {
    const ics = buildIcs({ ...base, title: 'रात के खाने की याद दिलाना 🎉 '.repeat(6) }, NOW);

    lines(ics).forEach((line) => {
      expect(Buffer.from(line, 'utf8').length).toBeLessThanOrEqual(75);
    });
  });
});

describe('icsFilename', () => {
  it('slugs the title', () => {
    expect(icsFilename('Dentist appointment')).toBe('dentist-appointment.ics');
  });

  it('falls back when a title has nothing sluggable', () => {
    expect(icsFilename('🎉🎉')).toBe('reminder.ics');
  });
});
