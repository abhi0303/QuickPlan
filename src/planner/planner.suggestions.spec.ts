import { buildSuggestions, CategoryFacts } from './planner.suggestions';

const fact = (over: Partial<CategoryFacts> = {}): CategoryFacts => ({
  category: 'Food',
  monthly: 5000,
  median: 5000,
  lastMonth: 5000,
  budget: null,
  smallCount: 0,
  smallAverage: 0,
  ...over,
});

describe('buildSuggestions', () => {
  it('is silent when nothing is unusual', () => {
    expect(buildSuggestions([fact()], 85000, 40000)).toEqual([]);
  });

  it('fires ABOVE_NORM at 25% over the median, and names both numbers', () => {
    const [s] = buildSuggestions([fact({ median: 7500, lastMonth: 9800 })], 85000, 40000);

    expect(s.rule).toBe('ABOVE_NORM');
    expect(s.saves).toBe(2300);
    expect(s.evidence).toContain('7,500');
    expect(s.evidence).toContain('9,800');
  });

  it('does not fire ABOVE_NORM just under the threshold', () => {
    const out = buildSuggestions([fact({ median: 8000, lastMonth: 9900 })], 85000, 40000);

    expect(out.map((s) => s.rule)).not.toContain('ABOVE_NORM');
  });

  it('fires on a large share of income', () => {
    const out = buildSuggestions([fact({ monthly: 16000 })], 85000, 40000);

    expect(out.map((s) => s.rule)).toContain('LARGE_SHARE_OF_INCOME');
  });

  it('fires on many small expenses and quotes ten of them', () => {
    const [s] = buildSuggestions(
      [fact({ smallCount: 23, smallAverage: 240 })],
      85000,
      40000,
    );

    expect(s.rule).toBe('MANY_SMALL');
    expect(s.saves).toBe(2400);
  });

  it('fires when the average is over a budget the user set', () => {
    const [s] = buildSuggestions([fact({ monthly: 9600, budget: 8000 })], 85000, 40000);

    expect(s.rule).toBe('OVER_BUDGET');
    expect(s.saves).toBe(1600);
  });

  /** Rent, EMI, Loan, Bills and Investments are commitments, not choices. */
  it.each(['Rent', 'EMI', 'Loan', 'Bills', 'Investments'])(
    'never suggests trimming %s',
    (category) => {
      const out = buildSuggestions(
        [fact({ category, monthly: 30000, median: 5000, lastMonth: 30000, smallCount: 20, smallAverage: 300 })],
        85000,
        40000,
      );

      expect(out.filter((s) => s.category === category)).toEqual([]);
    },
  );

  it('ranks by money, not by which rule fired', () => {
    const out = buildSuggestions(
      [
        fact({ category: 'Coffee', smallCount: 12, smallAverage: 240 }),
        fact({ category: 'Shopping', median: 900, lastMonth: 38000, monthly: 12966 }),
      ],
      85000,
      40000,
    );

    expect(out[0].category).toBe('Shopping');
    expect(out[0].saves).toBeGreaterThan(out[1].saves);
  });

  it('adds the low-rate nudge when savings are under 10%', () => {
    const out = buildSuggestions([fact({ median: 5000, lastMonth: 9000 })], 85000, 4000);

    expect(out[0].rule).toBe('LOW_SAVINGS_RATE');
    expect(out[0].headline).toMatch(/saving 5%/);
  });

  /** The tone rule: state the gap, do not scold, and never quote a nonsense percentage. */
  it('states a shortfall plainly when the number is negative', () => {
    const out = buildSuggestions([fact({ median: 5000, lastMonth: 9000 })], 20000, -26067);

    expect(out[0].rule).toBe('SHORTFALL');
    expect(out[0].headline).toContain('short of covering this month');
    expect(out[0].headline).not.toMatch(/-\d+%/);
    // The income figure must not travel in a string that may become a push.
    expect(out[0].evidence).not.toContain('20,000');
    expect(out[0].evidence).toContain('26,067');
  });

  it('never promises a rate above 100%', () => {
    const out = buildSuggestions(
      [fact({ category: 'Shopping', median: 100, lastMonth: 90000, monthly: 90000 })],
      85000,
      1000,
    );

    const nudge = out.find((s) => s.rule === 'LOW_SAVINGS_RATE');
    expect(nudge?.headline).not.toMatch(/[2-9]\d\d%/);
  });
});
