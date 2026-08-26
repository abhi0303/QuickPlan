import { isSuggestable, round2 } from './planner.math';

export interface CategoryFacts {
  category: string;
  /** The monthly estimate the plan is using. */
  monthly: number;
  median: number;
  lastMonth: number;
  budget: number | null;
  smallCount: number;
  smallAverage: number;
}

export interface Suggestion {
  id: string;
  rule: string;
  category: string | null;
  saves: number;
  headline: string;
  evidence: string;
}

const money = (value: number) => `₹${Math.round(value).toLocaleString('en-IN')}`;

/**
 * A suggestion is only produced when it can name a number and where the number
 * came from. Nothing here is advice - every line is arithmetic the user can
 * check against their own history.
 */
export function buildSuggestions(
  facts: CategoryFacts[],
  income: number,
  canSave: number,
): Suggestion[] {
  const out: Suggestion[] = [];

  for (const fact of facts) {
    // Commitments are not choices, and Investments leaving the account is the
    // opposite of the thing this page is for.
    if (!isSuggestable(fact.category)) {
      continue;
    }

    if (fact.median > 0 && fact.lastMonth >= fact.median * 1.25) {
      const saves = round2(fact.lastMonth - fact.median);

      out.push({
        id: `above-norm-${fact.category}`,
        rule: 'ABOVE_NORM',
        category: fact.category,
        saves,
        headline: `${fact.category} was ${money(saves)} over your usual last month`,
        evidence: `${money(fact.lastMonth)} against a three-month median of ${money(fact.median)}`,
      });
    }

    if (income > 0 && fact.monthly > income * 0.15) {
      const share = round2((fact.monthly / income) * 100);

      out.push({
        id: `income-share-${fact.category}`,
        rule: 'LARGE_SHARE_OF_INCOME',
        category: fact.category,
        saves: round2(fact.monthly - income * 0.15),
        headline: `${fact.category} is ${Math.round(share)}% of what you earn`,
        // Deliberately a share, not the income figure: these strings may be
        // pushed as notifications later, and income must never travel in one.
        evidence: `${money(fact.monthly)} a month, ${Math.round(share)}% of what you earn`,
      });
    }

    if (fact.smallCount >= 10 && fact.smallAverage > 0) {
      const saves = round2(fact.smallAverage * 10);

      out.push({
        id: `many-small-${fact.category}`,
        rule: 'MANY_SMALL',
        category: fact.category,
        saves,
        headline: `${fact.smallCount} small ${fact.category} expenses averaging ${money(fact.smallAverage)}`,
        evidence: `Ten fewer is ${money(saves)}`,
      });
    }

    if (fact.budget !== null && fact.monthly > fact.budget) {
      const saves = round2(fact.monthly - fact.budget);

      out.push({
        id: `over-budget-${fact.category}`,
        rule: 'OVER_BUDGET',
        category: fact.category,
        saves,
        headline: `You set ${money(fact.budget)} for ${fact.category} and average ${money(fact.monthly)}`,
        evidence: `${money(saves)} a month over the limit you chose`,
      });
    }
  }

  // Ranked by what the suggestion is worth, not by how sure the rule is.
  out.sort((a, b) => b.saves - a.saves);

  if (income > 0 && canSave < income * 0.1) {
    const topTwo = out.slice(0, 2);
    const reachable = round2(topTwo.reduce((sum, s) => sum + s.saves, 0));

    if (canSave < 0) {
      // Somebody overspending already knows. What they do not have is the
      // arithmetic, so state the gap and point at the movable lines - no
      // percentage, which reads as nonsense on a negative, and no scolding.
      out.unshift({
        id: 'low-savings-rate',
        rule: 'SHORTFALL',
        category: null,
        saves: reachable,
        headline: `${money(Math.abs(canSave))} short of covering this month`,
        evidence:
          topTwo.length > 0
            ? `Commitments and spending exceed what you earn by ${money(Math.abs(canSave))}. The lines below are worth ${money(reachable)}.`
            : `Commitments and spending exceed what you earn by ${money(Math.abs(canSave))}.`,
      });

      return out;
    }

    const rate = round2((canSave / income) * 100);
    const improved = Math.min(100, Math.round(((canSave + reachable) / income) * 100));

    out.unshift({
      id: 'low-savings-rate',
      rule: 'LOW_SAVINGS_RATE',
      category: null,
      saves: reachable,
      headline:
        topTwo.length > 0
          ? `You are saving ${Math.round(rate)}%. Trimming the lines below gets you to ${improved}%`
          : `You are saving ${Math.round(rate)}% of what you earn`,
      evidence: `${money(canSave)} left after commitments and spending`,
    });
  }

  return out;
}
