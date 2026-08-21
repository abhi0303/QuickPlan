import { Prisma } from '@prisma/client';

/**
 * Money is stored as DECIMAL(12,2) so sums stay exact, but the HTTP contract
 * has always used plain numbers. Convert only at the API boundary - never do
 * arithmetic on the result.
 */
export function toNumber(value: Prisma.Decimal | number): number {
  return value instanceof Prisma.Decimal ? value.toNumber() : value;
}

export function toDecimal(value: number | string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

/**
 * Splits an amount into `count` shares that add up to exactly the total.
 * Naive rounding loses money: 100 / 3 rounds to 33.33 each and leaves 0.01
 * unassigned. The remainder is pushed onto the first share instead.
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
