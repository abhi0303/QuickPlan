/**
 * Static level configuration. Held in code rather than the database so the 100
 * bands and rank names are never duplicated per user.
 *
 * XP to clear level N is 100 + (N - 1) * 10, so the cumulative total to have
 * finished level N is 100N + 5N(N - 1):
 *
 *   level 1 -> 100     level 4 -> 460     level 100 -> 59,500
 */
export const MAX_LEVEL = 100;

export function xpForLevel(level: number): number {
  return 100 + (level - 1) * 10;
}

/** Total XP needed to have completed every level up to and including `level`. */
export function cumulativeXp(level: number): number {
  if (level <= 0) {
    return 0;
  }

  const capped = Math.min(level, MAX_LEVEL);

  return 100 * capped + 5 * capped * (capped - 1);
}

/**
 * A user is on level N once they hold the cumulative XP for every level below
 * it. Closed form rather than a loop, so a large XP jump resolves in one step.
 */
export function levelFromXp(totalXp: number): number {
  if (totalXp < 100) {
    return 1;
  }

  if (totalXp >= cumulativeXp(MAX_LEVEL)) {
    return MAX_LEVEL;
  }

  // Solve 100n + 5n(n-1) <= xp  ->  5n^2 + 95n - xp <= 0
  const n = Math.floor((-95 + Math.sqrt(95 * 95 + 20 * totalXp)) / 10);
  let level = Math.max(1, Math.min(n, MAX_LEVEL));

  // Guard against floating point landing a level either side of the boundary.
  while (level < MAX_LEVEL && cumulativeXp(level) <= totalXp) {
    level++;
  }

  while (level > 1 && cumulativeXp(level - 1) > totalXp) {
    level--;
  }

  return level;
}

/**
 * Rank names progress through five tiers, matching the icon tiers the frontend
 * ships: beginner, saving, growth, mastery, legendary, and a unique 100th.
 */
export const RANK_NAMES: readonly string[] = [
  // 1-20 · beginner: coins, wallets, receipts
  'Penny Starter', 'Coin Keeper', 'Expense Rookie', 'Receipt Collector', 'Pocket Tracker',
  'Change Counter', 'Wallet Watcher', 'Note Taker', 'Bill Spotter', 'Ledger Novice',
  'Tally Hand', 'Slip Sorter', 'Cash Cadet', 'Purse Keeper', 'Spend Scout',
  'Balance Beginner', 'Record Ranger', 'Coin Collector', 'Budget Hatchling', 'Steady Saver',
  // 21-40 · saving and budgeting
  'Frugal Apprentice', 'Thrift Tactician', 'Envelope Planner', 'Savings Builder', 'Budget Strategist',
  'Goal Setter', 'Surplus Seeker', 'Rainy Day Ranger', 'Interest Initiate', 'Nest Builder',
  'Prudent Planner', 'Careful Custodian', 'Reserve Ranger', 'Margin Maker', 'Cushion Crafter',
  'Steady Steward', 'Deposit Adept', 'Vault Keeper', 'Fund Founder', 'Capital Cadet',
  // 41-60 · growth, strategy, analytics
  'Growth Seeker', 'Trend Reader', 'Chart Charter', 'Data Diviner', 'Pattern Finder',
  'Insight Analyst', 'Forecast Adept', 'Yield Hunter', 'Portfolio Pilot', 'Compound Captain',
  'Strategy Smith', 'Allocation Ace', 'Risk Reader', 'Metric Master', 'Signal Seeker',
  'Ratio Ranger', 'Curve Charter', 'Momentum Maker', 'Leverage Lieutenant', 'Growth Guardian',
  // 61-80 · mastery and achievement
  'Ledger Master', 'Finance Adept', 'Wealth Warden', 'Treasury Tactician', 'Fiscal Marshal',
  'Account Archon', 'Balance Baron', 'Prosperity Pilot', 'Fortune Forger', 'Asset Architect',
  'Equity Elder', 'Reserve Regent', 'Capital Commander', 'Wealth Weaver', 'Sterling Sentinel',
  'Bullion Baron', 'Vault Vanguard', 'Coffer Champion', 'Treasury Titan', 'Fortune Marshal',
  // 81-99 · legendary and mythic
  'Gilded Legend', 'Mythic Miser', 'Fabled Financier', 'Arcane Accountant', 'Eternal Earner',
  'Celestial Saver', 'Astral Auditor', 'Radiant Steward', 'Sovereign Strategist', 'Immortal Investor',
  'Prime Patron', 'Grand Treasurer', 'Legendary Ledger', 'Mythic Marshal', 'Ascendant Analyst',
  'Transcendent Trader', 'Infinite Investor', 'Paragon of Prosperity', 'Apex Accumulator',
  // 100 · unique
  'Ultimate Money Master',
];

export function rankName(level: number): string {
  const index = Math.min(Math.max(level, 1), MAX_LEVEL) - 1;

  return RANK_NAMES[index] ?? RANK_NAMES[RANK_NAMES.length - 1];
}

export interface LevelState {
  level: number;
  rankName: string;
  /** Cumulative XP at which the current level began. */
  currentLevelXp: number;
  /** Cumulative XP at which the next level begins. */
  nextLevelXp: number;
  xpIntoLevel: number;
  xpForNextLevel: number;
  progressPercentage: number;
}

export function levelState(totalXp: number): LevelState {
  const level = levelFromXp(totalXp);
  const currentLevelXp = cumulativeXp(level - 1);
  const nextLevelXp = cumulativeXp(level);
  const band = nextLevelXp - currentLevelXp;
  const xpIntoLevel = totalXp - currentLevelXp;

  return {
    level,
    rankName: rankName(level),
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel: band,
    // At the cap there is no next band to make progress against.
    progressPercentage:
      level >= MAX_LEVEL ? 100 : Number(((xpIntoLevel / band) * 100).toFixed(2)),
  };
}
