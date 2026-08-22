import { Prisma } from '@prisma/client';
import { splitEvenly, suggestSettlements } from './money';

const d = (v: string | number) => new Prisma.Decimal(v);
const sum = (xs: Prisma.Decimal[]) => xs.reduce((a, b) => a.add(b), d(0));

describe('splitEvenly', () => {
  it('divides cleanly when it can', () => {
    expect(splitEvenly(d(1200), 4).map(String)).toEqual(['300', '300', '300', '300']);
  });

  it('gives the remainder to one share instead of losing it', () => {
    const shares = splitEvenly(d(100), 3);
    expect(shares.map(String)).toEqual(['33.34', '33.33', '33.33']);
    expect(sum(shares).toString()).toBe('100');
  });

  it('never loses a paisa across awkward totals', () => {
    for (const [total, count] of [[0.01, 3], [50, 3], [999.99, 7], [1, 6]] as const) {
      expect(sum(splitEvenly(d(total), count)).toString()).toBe(d(total).toString());
    }
  });
});

describe('suggestSettlements', () => {
  it('matches one debtor to one creditor', () => {
    const transfers = suggestSettlements([
      { userId: 'a', net: d(-500) },
      { userId: 'b', net: d(500) },
    ]);

    expect(transfers).toHaveLength(1);
    expect(transfers[0].fromUserId).toBe('a');
    expect(transfers[0].toUserId).toBe('b');
    expect(transfers[0].amount.toString()).toBe('500');
  });

  it('clears a three-way imbalance in the fewest payments', () => {
    const transfers = suggestSettlements([
      { userId: 'a', net: d(-300) },
      { userId: 'b', net: d(-200) },
      { userId: 'c', net: d(500) },
    ]);

    expect(transfers).toHaveLength(2);
    expect(transfers.every((t) => t.toUserId === 'c')).toBe(true);
    expect(sum(transfers.map((t) => t.amount)).toString()).toBe('500');
  });

  it('returns nothing when everyone is square', () => {
    expect(suggestSettlements([{ userId: 'a', net: d(0) }, { userId: 'b', net: d(0) }])).toEqual([]);
  });

  it('conserves money: transfers equal the total owed', () => {
    const balances = [
      { userId: 'a', net: d('-120.55') },
      { userId: 'b', net: d('-79.45') },
      { userId: 'c', net: d('150.00') },
      { userId: 'd', net: d('50.00') },
    ];

    const transfers = suggestSettlements(balances);
    expect(sum(transfers.map((t) => t.amount)).toString()).toBe('200');
  });
});
