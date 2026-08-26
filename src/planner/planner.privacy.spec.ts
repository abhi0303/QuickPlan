import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

/**
 * monthlyIncome is the most sensitive field the app holds. This asserts the
 * property rather than trusting a review: it must never reach a log line, an
 * error report or a notification payload.
 */
describe('income privacy', () => {
  const dir = join(__dirname);
  const sources = readdirSync(dir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'))
    .map((f) => ({ file: f, code: readFileSync(join(dir, f), 'utf8') }));

  it('the planner logs nothing', () => {
    for (const { file, code } of sources) {
      expect({ file, hit: /this\.logger\.|console\./.test(code) }).toEqual({ file, hit: false });
    }
  });

  it('the planner emits no notifications, so income cannot reach a push payload', () => {
    for (const { file, code } of sources) {
      expect({ file, hit: /NotificationEmitter|emitter\.emit/.test(code) }).toEqual({
        file,
        hit: false,
      });
    }
  });

  it('income appears only where it is read or returned, never interpolated into a string', () => {
    for (const { file, code } of sources) {
      // A template literal carrying income is how it would leak into a message.
      expect({ file, hit: /\$\{[^}]*[iI]ncome[^}]*\}/.test(code) }).toEqual({ file, hit: false });
    }
  });
});
