import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { GroupsService } from '../groups/groups.service';
import { AnalyticsQueryDto, TimeBucket } from './dto/analytics-query.dto';
import { toNumber, ZERO } from '../common/money';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
    private readonly groups: GroupsService,
  ) {}

  /**
   * Everything a group's charts need in one round trip: a pie by category, a
   * bar by member, a line over time, and the headline totals.
   */
  async groupAnalytics(userId: string, groupId: string, query: AnalyticsQueryDto) {
    await this.access.requireMembership(userId, groupId);

    const where = this.dateWindow({ groupId }, query);

    const [byCategory, byPayer, expenses, balances] = await Promise.all([
      this.prisma.expense.groupBy({
        by: ['category'],
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.groupBy({
        by: ['paidById'],
        where,
        _sum: { totalAmount: true },
        _count: { _all: true },
      }),
      this.prisma.expense.findMany({
        where,
        select: { date: true, totalAmount: true },
        orderBy: { date: 'asc' },
      }),
      this.groups.balancesFor(groupId),
    ]);

    const nameOf = new Map(balances.map((b) => [b.userId, b.name]));
    const grandTotal = expenses.reduce((sum, e) => sum.add(e.totalAmount), ZERO);

    return {
      groupId,
      totals: {
        totalSpend: toNumber(grandTotal),
        expenseCount: expenses.length,
        averageExpense: expenses.length
          ? toNumber(grandTotal.div(expenses.length).toDecimalPlaces(2))
          : 0,
      },
      // Pie chart: share of spend per category.
      byCategory: byCategory
        .map((row) => ({
          category: row.category,
          total: toNumber(row._sum.totalAmount),
          count: row._count._all,
          percentage: this.percentage(row._sum.totalAmount, grandTotal),
        }))
        .sort((a, b) => b.total - a.total),
      // Bar chart: what each member paid, owes and nets out at.
      byMember: balances.map((b) => ({
        userId: b.userId,
        name: b.name,
        paid: b.paid,
        owed: b.owed,
        net: b.net,
        expensesPaid: byPayer.find((p) => p.paidById === b.userId)?._count._all ?? 0,
      })),
      // Line chart: spend over time.
      overTime: this.bucketise(expenses, query.bucket ?? TimeBucket.MONTH),
    };
  }

  /**
   * The same shape across every group the user belongs to, for a personal
   * dashboard: what they are owed, what they owe, and where their money goes.
   */
  async myAnalytics(userId: string, query: AnalyticsQueryDto) {
    const groupIds = await this.access.memberGroupIds(userId);

    if (groupIds.length === 0) {
      return this.emptySummary();
    }

    const where = this.dateWindow({ groupId: { in: groupIds } }, query);

    const [myShares, myExpenses, groups] = await Promise.all([
      this.prisma.expenseShare.findMany({
        where: { userId, expense: where },
        include: { expense: { select: { date: true, category: true, groupId: true } } },
      }),
      this.prisma.expense.findMany({
        where: { ...where, paidById: userId },
        select: { totalAmount: true },
      }),
      this.prisma.group.findMany({
        where: { id: { in: groupIds } },
        select: { id: true, name: true, currency: true },
      }),
    ]);

    // My spend is my share of things, not what I fronted - that is the number
    // that answers "where does my money go".
    const myTotal = myShares.reduce((sum, s) => sum.add(s.amount), ZERO);
    const paidOut = myExpenses.reduce((sum, e) => sum.add(e.totalAmount), ZERO);

    const categoryTotals = new Map<string, Prisma.Decimal>();

    for (const share of myShares) {
      const key = share.expense.category;
      categoryTotals.set(key, (categoryTotals.get(key) ?? ZERO).add(share.amount));
    }

    const perGroup = await Promise.all(
      groups.map(async (group) => {
        const balances = await this.groups.balancesFor(group.id);
        const mine = balances.find((b) => b.userId === userId);

        return {
          groupId: group.id,
          name: group.name,
          currency: group.currency,
          net: mine?.net ?? 0,
          myShareTotal: toNumber(
            myShares
              .filter((s) => s.expense.groupId === group.id)
              .reduce((sum, s) => sum.add(s.amount), ZERO),
          ),
        };
      }),
    );

    const owedToMe = perGroup.filter((g) => g.net > 0).reduce((sum, g) => sum + g.net, 0);
    const iOwe = perGroup.filter((g) => g.net < 0).reduce((sum, g) => sum - g.net, 0);

    return {
      totals: {
        myTotalShare: toNumber(myTotal),
        totalIPaidOut: toNumber(paidOut),
        owedToMe: Number(owedToMe.toFixed(2)),
        iOwe: Number(iOwe.toFixed(2)),
        netBalance: Number((owedToMe - iOwe).toFixed(2)),
      },
      byCategory: [...categoryTotals.entries()]
        .map(([category, total]) => ({
          category,
          total: toNumber(total),
          percentage: this.percentage(total, myTotal),
        }))
        .sort((a, b) => b.total - a.total),
      byGroup: perGroup.sort((a, b) => Math.abs(b.net) - Math.abs(a.net)),
      overTime: this.bucketise(
        myShares.map((s) => ({ date: s.expense.date, totalAmount: s.amount })),
        query.bucket ?? TimeBucket.MONTH,
      ),
    };
  }

  private emptySummary() {
    return {
      totals: { myTotalShare: 0, totalIPaidOut: 0, owedToMe: 0, iOwe: 0, netBalance: 0 },
      byCategory: [],
      byGroup: [],
      overTime: [],
    };
  }

  private dateWindow(base: Prisma.ExpenseWhereInput, query: AnalyticsQueryDto) {
    if (!query.from && !query.to) {
      return base;
    }

    return {
      ...base,
      date: {
        ...(query.from ? { gte: new Date(query.from) } : {}),
        ...(query.to ? { lte: new Date(query.to) } : {}),
      },
    };
  }

  private percentage(part: Prisma.Decimal | null, whole: Prisma.Decimal): number {
    if (!part || whole.isZero()) {
      return 0;
    }

    return Number(part.div(whole).mul(100).toDecimalPlaces(2).toString());
  }

  /**
   * Buckets are built in UTC and returned as sorted, gap-free-by-presence
   * keys, so the chart can plot them directly without regrouping.
   */
  private bucketise(
    rows: Array<{ date: Date; totalAmount: Prisma.Decimal }>,
    bucket: TimeBucket,
  ): Array<{ period: string; total: number; count: number }> {
    const totals = new Map<string, { total: Prisma.Decimal; count: number }>();

    for (const row of rows) {
      const key = this.bucketKey(row.date, bucket);
      const current = totals.get(key) ?? { total: ZERO, count: 0 };
      totals.set(key, { total: current.total.add(row.totalAmount), count: current.count + 1 });
    }

    return [...totals.entries()]
      .map(([period, value]) => ({ period, total: toNumber(value.total), count: value.count }))
      .sort((a, b) => a.period.localeCompare(b.period));
  }

  private bucketKey(date: Date, bucket: TimeBucket): string {
    const iso = date.toISOString();

    if (bucket === TimeBucket.DAY) {
      return iso.slice(0, 10);
    }

    if (bucket === TimeBucket.MONTH) {
      return iso.slice(0, 7);
    }

    // Week: label by the Monday that starts it, so keys sort chronologically.
    const monday = new Date(date);
    const weekday = (monday.getUTCDay() + 6) % 7;
    monday.setUTCDate(monday.getUTCDate() - weekday);

    return monday.toISOString().slice(0, 10);
  }
}
