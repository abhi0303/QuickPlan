import {
  cumulativeXp,
  levelFromXp,
  levelState,
  MAX_LEVEL,
  rankName,
  RANK_NAMES,
  xpForLevel,
} from './level.config';

describe('level curve', () => {
  it('matches the specified per-level cost', () => {
    expect([1, 2, 3, 4, 5].map(xpForLevel)).toEqual([100, 110, 120, 130, 140]);
    expect(xpForLevel(MAX_LEVEL)).toBe(1090);
  });

  it('matches the specified cumulative totals', () => {
    expect([1, 2, 3, 4, 5].map(cumulativeXp)).toEqual([100, 210, 330, 460, 600]);
    expect(cumulativeXp(MAX_LEVEL)).toBe(59500);
  });

  it('agrees with a brute-force sum at every level', () => {
    let running = 0;

    for (let level = 1; level <= MAX_LEVEL; level++) {
      running += xpForLevel(level);
      expect(cumulativeXp(level)).toBe(running);
    }
  });
});

describe('levelFromXp', () => {
  it('starts everyone at level 1', () => {
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(99)).toBe(1);
  });

  it('promotes exactly on the boundary', () => {
    expect(levelFromXp(100)).toBe(2);
    expect(levelFromXp(209)).toBe(2);
    expect(levelFromXp(210)).toBe(3);
  });

  /** The worked example from the spec. */
  it('carries surplus XP forward instead of resetting it', () => {
    expect(levelFromXp(390)).toBe(4);
    expect(levelFromXp(490)).toBe(5);

    const state = levelState(490);
    expect(state.currentLevelXp).toBe(460);
    expect(state.xpIntoLevel).toBe(30);
  });

  it('is consistent with the cumulative table at every level', () => {
    for (let level = 1; level <= MAX_LEVEL; level++) {
      const floor = cumulativeXp(level - 1);
      expect(levelFromXp(floor)).toBe(level);
      expect(levelFromXp(floor + 1)).toBe(level);

      if (level < MAX_LEVEL) {
        expect(levelFromXp(cumulativeXp(level) - 1)).toBe(level);
      }
    }
  });

  it('caps at 100 however much XP is earned', () => {
    expect(levelFromXp(59500)).toBe(MAX_LEVEL);
    expect(levelFromXp(10_000_000)).toBe(MAX_LEVEL);
  });

  it('handles a jump worth several levels at once', () => {
    // 600 XP clears levels 1-5 outright, so the user lands on 6 - the same
    // rule as 100 XP putting a new user on level 2.
    expect(levelFromXp(0)).toBe(1);
    expect(levelFromXp(600)).toBe(6);
    expect(levelFromXp(599)).toBe(5);
  });
});

describe('levelState', () => {
  it('reports progress within the current band', () => {
    const state = levelState(4850);

    expect(state.level).toBe(24);
    expect(state.rankName).toBe('Savings Builder');
    expect(state.currentLevelXp).toBe(cumulativeXp(23));
    expect(state.nextLevelXp).toBe(cumulativeXp(24));
    expect(state.xpForNextLevel).toBe(xpForLevel(24));
    expect(state.progressPercentage).toBeGreaterThan(0);
    expect(state.progressPercentage).toBeLessThan(100);
  });

  it('shows a full bar at the cap rather than dividing by an absent band', () => {
    const state = levelState(59500);

    expect(state.level).toBe(MAX_LEVEL);
    expect(state.progressPercentage).toBe(100);
    expect(Number.isFinite(state.progressPercentage)).toBe(true);
  });
});

describe('ranks', () => {
  it('defines exactly one name per level', () => {
    expect(RANK_NAMES).toHaveLength(MAX_LEVEL);
    expect(new Set(RANK_NAMES).size).toBe(MAX_LEVEL);
  });

  it('names the levels the spec calls out', () => {
    expect(rankName(1)).toBe('Penny Starter');
    expect(rankName(2)).toBe('Coin Keeper');
    expect(rankName(3)).toBe('Expense Rookie');
    expect(rankName(25)).toBe('Budget Strategist');
    expect(rankName(100)).toBe('Ultimate Money Master');
  });

  it('clamps out-of-range levels instead of returning undefined', () => {
    expect(rankName(0)).toBe('Penny Starter');
    expect(rankName(999)).toBe('Ultimate Money Master');
  });
});
