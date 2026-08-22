import { Prisma } from '@prisma/client';

/**
 * Money is stored as DECIMAL(12,2) so sums stay exact, but the HTTP contract
 * uses plain numbers. Convert only at the API boundary - never do arithmetic
 * on the result.
 */
export function toNumber(value: Prisma.Decimal | number | null | undefined): number {
  if (value === null || value === undefined) {
    return 0;
  }

  return value instanceof Prisma.Decimal ? value.toNumber() : value;
}

export function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

export const ZERO = new Prisma.Decimal(0);

/**
 * Splits an amount into shares that add up to exactly the total. Naive
 * rounding loses money: 100 across 3 people rounds to 33.33 each and leaves
 * 0.01 unassigned. The remainder goes to the first share.
 */
export function splitEvenly(total: Prisma.Decimal, count: number): Prisma.Decimal[] {
  const base = total.div(count).toDecimalPlaces(2, Prisma.Decimal.ROUND_DOWN);
  const shares = Array.from({ length: count }, () => base);
  const remainder = total.sub(base.mul(count));

  if (remainder.isZero()) {
    return shares;
  }

  return shares.map((share, index) => (index === 0 ? share.add(remainder) : share));
}

/**
 * Turns per-member net positions into the fewest payments that clear them:
 * biggest debtor pays the biggest creditor, repeat. This is what the UI shows
 * as "you owe X", rather than a raw balance sheet.
 */
export function suggestSettlements(
  balances: Array<{ userId: string; net: Prisma.Decimal }>,
): Array<{ fromUserId: string; toUserId: string; amount: Prisma.Decimal }> {
  const debtors = balances
    .filter((b) => b.net.lessThan(0))
    .map((b) => ({ userId: b.userId, amount: b.net.abs() }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

  const creditors = balances
    .filter((b) => b.net.greaterThan(0))
    .map((b) => ({ userId: b.userId, amount: b.net }))
    .sort((a, b) => b.amount.comparedTo(a.amount));

  const transfers: Array<{ fromUserId: string; toUserId: string; amount: Prisma.Decimal }> = [];
  let i = 0;
  let j = 0;

  while (i < debtors.length && j < creditors.length) {
    const amount = Prisma.Decimal.min(debtors[i].amount, creditors[j].amount);

    if (amount.greaterThan(0)) {
      transfers.push({
        fromUserId: debtors[i].userId,
        toUserId: creditors[j].userId,
        amount,
      });
    }

    debtors[i].amount = debtors[i].amount.sub(amount);
    creditors[j].amount = creditors[j].amount.sub(amount);

    if (debtors[i].amount.isZero()) i++;
    if (creditors[j].amount.isZero()) j++;
  }

  return transfers;
}
