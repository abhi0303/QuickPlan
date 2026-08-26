import { Injectable, NotFoundException } from '@nestjs/common';
import {
  BudgetPlan,
  BudgetPlanItem,
  BudgetPeriod,
  CreatedVia,
  ExpenseScope,
  PlanItemSource,
  RecurringExpense,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber, toDecimal } from '../common/money';
import { UpsertPlanDto, UpdatePlanItemDto } from './dto/planner.dto';
import {
  completeMonthsBetween,
  historyWindow,
  median,
  monthKeys,
  monthStart,
  round2,
  toMonthly,
} from './planner.math';
import { buildSuggestions, CategoryFacts } from './planner.suggestions';

const HISTORY_MONTHS = 3;
const SMALL_EXPENSE_CEILING = 500;

interface MonthlyCategoryTotals {
  /** category -> month key -> total at the user's share */
  byMonth: Map<string, Map<string, number>>;
  largest: Map<string, { expenseId: string; title: string; amount: number; date: Date }>;
  smallCounts: Map<string, { count: number; total: number }>;
  firstSeen: Date | null;
}

@Injectable()
export class PlannerService {
  constructor(private readonly prisma: PrismaService) {}

  // ------------------------------------------------------------------
  // Plan lifecycle
  // ------------------------------------------------------------------

  /** A change of income archives and replaces, so past plans keep their figures. */
  async upsert(userId: string, dto: UpsertPlanDto) {
    const current = await this.activePlan(userId);

    if (current) {
      const sameIncome = toNumber(current.monthlyIncome) === dto.monthlyIncome;

      if (sameIncome) {
        await this.prisma.budgetPlan.update({
          where: { id: current.id },
          data: {
            savingsTarget:
              dto.savingsTarget === undefined ? current.savingsTarget : toDecimal(dto.savingsTarget),
          },
        });

        return this.get(userId);
      }

      await this.prisma.budgetPlan.update({
        where: { id: current.id },
        data: { archivedAt: new Date() },
      });
    }

    await this.prisma.budgetPlan.create({
      data: {
        userId,
        monthlyIncome: toDecimal(dto.monthlyIncome),
        savingsTarget: dto.savingsTarget !== undefined ? toDecimal(dto.savingsTarget) : null,
      },
    });

    return this.get(userId);
  }

  async archive(userId: string) {
    const plan = await this.activePlan(userId);

    if (!plan) {
      throw new NotFoundException('No plan to archive.');
    }

    await this.prisma.budgetPlan.update({
      where: { id: plan.id },
      data: { archivedAt: new Date() },
    });

    return { archived: true, planId: plan.id };
  }

  async updateItem(userId: string, itemId: string, dto: UpdatePlanItemDto) {
    const item = await this.prisma.budgetPlanItem.findFirst({
      where: { id: itemId, plan: { userId, archivedAt: null } },
    });

    if (!item) {
      throw new NotFoundException(`Plan item ${itemId} not found`);
    }

    await this.prisma.budgetPlanItem.update({
      where: { id: itemId },
      data: {
        ...(dto.included !== undefined ? { included: dto.included } : {}),
        ...(dto.amountOverride !== undefined
          ? { amountOverride: dto.amountOverride === null ? null : toDecimal(dto.amountOverride) }
          : {}),
      },
    });

    return this.get(userId);
  }

  // ------------------------------------------------------------------
  // The computed plan
  // ------------------------------------------------------------------

  /**
   * Arrives ready to render. The client does no arithmetic, for the same reason
   * budget status does none: two places computing "what you can save" will
   * eventually disagree, and the one on screen will be the wrong one.
   */
  async get(userId: string, now = new Date()) {
    const plan = await this.activePlan(userId);

    if (!plan) {
      // Without income nothing below it means anything.
      return {
        hasPlan: false,
        monthlyIncome: null,
        savingsTarget: null,
        committed: { total: 0, items: [] },
        estimated: { total: 0, basis: null, items: [] },
        canSave: 0,
        savingsRate: 0,
        suggestions: [],
      };
    }

    const income = toNumber(plan.monthlyIncome);
    const window = historyWindow(now, HISTORY_MONTHS);

    const [schedules, history, budgets] = await Promise.all([
      this.prisma.recurringExpense.findMany({
        where: {
          userId,
          OR: [{ endsOn: null }, { endsOn: { gte: now } }],
        },
      }),
      this.collectHistory(userId, window.from, window.to),
      this.prisma.budget.findMany({
        where: { userId, archivedAt: null, period: BudgetPeriod.MONTHLY },
      }),
    ]);

    const items = await this.ensureItems(plan.id, schedules, [...history.byMonth.keys()]);
    const groupShares = await this.groupShareFor(schedules);

    const committed = await this.buildCommitted(schedules, items, groupShares);
    const estimated = this.buildEstimated(history, items, budgets, now);

    const committedTotal = round2(
      committed.filter((c) => c.included && !c.paused).reduce((sum, c) => sum + c.monthly, 0),
    );
    const estimatedTotal = round2(
      estimated.filter((e) => e.included).reduce((sum, e) => sum + e.monthly, 0),
    );

    const canSave = round2(income - committedTotal - estimatedTotal);
    const savingsRate = income > 0 ? round2((canSave / income) * 100) : 0;

    // Categories a recurring schedule already covers are commitments, so the
    // planner never proposes trimming them.
    const scheduledCategories = new Set(
      schedules.map((s) => (s.category ?? 'General').toLowerCase()),
    );

    const facts: CategoryFacts[] = estimated
      .filter((line) => !scheduledCategories.has(line.category.toLowerCase()))
      .map((line) => ({
        category: line.category,
        monthly: line.monthly,
        median: line.median,
        lastMonth: line.lastMonth,
        budget: line.budget,
        smallCount: history.smallCounts.get(line.category)?.count ?? 0,
        smallAverage: this.smallAverage(history, line.category),
      }));

    return {
      hasPlan: true,
      monthlyIncome: income,
      savingsTarget: plan.savingsTarget !== null ? toNumber(plan.savingsTarget) : null,
      committed: { total: committedTotal, items: committed },
      estimated: {
        total: estimatedTotal,
        basis: this.basis(history, window, now),
        items: estimated,
      },
      canSave,
      savingsRate,
      suggestions: buildSuggestions(facts, income, canSave),
    };
  }

  /** Recomputing is just reading again — estimates are never stored. */
  async recalculate(userId: string) {
    return this.get(userId);
  }

  // ------------------------------------------------------------------
  // Committed
  // ------------------------------------------------------------------

  private async buildCommitted(
    schedules: RecurringExpense[],
    items: BudgetPlanItem[],
    groupShares: Map<string, number>,
  ) {
    return schedules.map((schedule) => {
      const item = items.find((i) => i.recurringId === schedule.id);
      const paused = schedule.pausedAt !== null;
      const full = toNumber(schedule.amount);
      // A group schedule is a commitment only at the user's share of it.
      const amount = schedule.scope === ExpenseScope.GROUP
        ? round2(full / (groupShares.get(schedule.groupId as string) ?? 1))
        : full;

      const monthly = item?.amountOverride !== null && item?.amountOverride !== undefined
        ? toNumber(item.amountOverride)
        : toMonthly(amount, schedule.cadence);

      return {
        id: item?.id ?? null,
        recurringId: schedule.id,
        label: schedule.title,
        category: schedule.category ?? 'General',
        cadence: schedule.cadence,
        amount,
        monthly,
        included: item?.included ?? true,
        // Excluded from the total, but still shown - a paused gym membership is
        // not a commitment this month and is a fact about next month.
        paused,
      };
    });
  }

  private async groupShareFor(schedules: RecurringExpense[]): Promise<Map<string, number>> {
    const groupIds = schedules
      .filter((s) => s.scope === ExpenseScope.GROUP && s.groupId)
      .map((s) => s.groupId as string);

    if (groupIds.length === 0) {
      return new Map();
    }

    const counts = await this.prisma.groupMember.groupBy({
      by: ['groupId'],
      where: { groupId: { in: groupIds } },
      _count: { _all: true },
    });

    return new Map(counts.map((row) => [row.groupId, Math.max(1, row._count._all)]));
  }

  // ------------------------------------------------------------------
  // Estimated
  // ------------------------------------------------------------------

  private buildEstimated(
    history: MonthlyCategoryTotals,
    items: BudgetPlanItem[],
    budgets: { category: string | null; amount: unknown }[],
    now: Date,
  ) {
    const monthsAvailable = history.firstSeen
      ? completeMonthsBetween(history.firstSeen, now, HISTORY_MONTHS)
      : HISTORY_MONTHS;

    const lastMonthKey = monthStart(now, 1).toISOString().slice(0, 7);
    // Every month in the window, so a category with no spending in May counts
    // as zero rather than dropping out. Without this the median is taken over
    // however many months happened to have data, which flatters a category that
    // was quiet and inflates the suggestion built on it.
    const windowKeys = monthKeys(now, HISTORY_MONTHS).slice(-monthsAvailable);

    return [...history.byMonth.entries()].map(([category, months]) => {
      const totals = windowKeys.map((key) => months.get(key) ?? 0);
      const sum = totals.reduce((a, b) => a + b, 0);
      const average = round2(sum / monthsAvailable);

      const item = items.find((i) => i.category === category);
      const budget = budgets.find((b) => b.category === category);
      const budgetAmount = budget ? toNumber(budget.amount as never) : null;

      // A limit you chose beats a habit you had, and it keeps the planner and
      // the budget from contradicting each other on the same screen.
      let monthly = average;
      let source: 'AVERAGE' | 'BUDGET' | 'OVERRIDE' = 'AVERAGE';

      if (budgetAmount !== null) {
        monthly = budgetAmount;
        source = 'BUDGET';
      }

      if (item?.amountOverride !== null && item?.amountOverride !== undefined) {
        monthly = toNumber(item.amountOverride);
        source = 'OVERRIDE';
      }

      const largest = history.largest.get(category);

      return {
        id: item?.id ?? null,
        category,
        monthly,
        source,
        included: item?.included ?? true,
        amountOverride: item?.amountOverride !== null && item?.amountOverride !== undefined
          ? toNumber(item.amountOverride)
          : null,
        average,
        median: median(totals),
        lastMonth: round2(months.get(lastMonthKey) ?? 0),
        budget: budgetAmount,
        // Reported as-is with the outlier named, rather than silently discarded:
        // the app does not get to decide which of someone's spending was real.
        outlier:
          largest && sum > 0 && largest.amount > sum / 2
            ? {
                expenseId: largest.expenseId,
                title: largest.title,
                amount: round2(largest.amount),
                date: largest.date,
              }
            : null,
      };
    }).sort((a, b) => b.monthly - a.monthly);
  }

  private basis(history: MonthlyCategoryTotals, window: { from: Date; to: Date }, now: Date) {
    const months = history.firstSeen
      ? completeMonthsBetween(history.firstSeen, now, HISTORY_MONTHS)
      : 0;

    return {
      months,
      from: window.from,
      to: window.to,
      complete: months >= HISTORY_MONTHS,
    };
  }

  /**
   * Everything the estimate needs, in two queries.
   *
   * SYSTEM expenses are excluded throughout: those are the rows the recurring
   * schedules created, they are already counted as commitments, and counting
   * them twice would overstate rent - the largest line most people have - by
   * exactly 100%.
   */
  private async collectHistory(userId: string, from: Date, to: Date): Promise<MonthlyCategoryTotals> {
    const [personal, shares] = await Promise.all([
      this.prisma.expense.findMany({
        where: {
          scope: ExpenseScope.PERSONAL,
          ownerId: userId,
          date: { gte: from, lte: to },
          createdVia: { not: CreatedVia.SYSTEM },
        },
        select: { id: true, title: true, category: true, totalAmount: true, date: true },
      }),
      this.prisma.expenseShare.findMany({
        where: {
          userId,
          expense: {
            scope: ExpenseScope.GROUP,
            date: { gte: from, lte: to },
            createdVia: { not: CreatedVia.SYSTEM },
          },
        },
        select: {
          amount: true,
          expense: { select: { id: true, title: true, category: true, date: true } },
        },
      }),
    ]);

    const rows = [
      ...personal.map((e) => ({
        id: e.id,
        title: e.title,
        category: e.category,
        amount: toNumber(e.totalAmount),
        date: e.date,
      })),
      // Group spending counts at the user's share, not the whole bill.
      ...shares.map((s) => ({
        id: s.expense.id,
        title: s.expense.title,
        category: s.expense.category,
        amount: toNumber(s.amount),
        date: s.expense.date,
      })),
    ];

    const byMonth = new Map<string, Map<string, number>>();
    const largest = new Map<string, { expenseId: string; title: string; amount: number; date: Date }>();
    const smallCounts = new Map<string, { count: number; total: number }>();
    let firstSeen: Date | null = null;

    for (const row of rows) {
      const monthKey = row.date.toISOString().slice(0, 7);
      const months = byMonth.get(row.category) ?? new Map<string, number>();

      months.set(monthKey, round2((months.get(monthKey) ?? 0) + row.amount));
      byMonth.set(row.category, months);

      const currentLargest = largest.get(row.category);

      if (!currentLargest || row.amount > currentLargest.amount) {
        largest.set(row.category, {
          expenseId: row.id,
          title: row.title,
          amount: row.amount,
          date: row.date,
        });
      }

      if (row.amount < SMALL_EXPENSE_CEILING) {
        const small = smallCounts.get(row.category) ?? { count: 0, total: 0 };
        smallCounts.set(row.category, {
          count: small.count + 1,
          total: round2(small.total + row.amount),
        });
      }

      if (!firstSeen || row.date < firstSeen) {
        firstSeen = row.date;
      }
    }

    return { byMonth, largest, smallCounts, firstSeen };
  }

  private smallAverage(history: MonthlyCategoryTotals, category: string): number {
    const small = history.smallCounts.get(category);

    return small && small.count > 0 ? round2(small.total / small.count) : 0;
  }

  // ------------------------------------------------------------------
  // Items
  // ------------------------------------------------------------------

  /**
   * Every line needs a stable id so it can be switched off, and the set of
   * lines follows the user's schedules and categories. Missing rows are created
   * here rather than snapshotted at plan creation, which would leave the plan
   * quietly stale.
   */
  private async ensureItems(
    planId: string,
    schedules: RecurringExpense[],
    categories: string[],
  ): Promise<BudgetPlanItem[]> {
    const existing = await this.prisma.budgetPlanItem.findMany({ where: { planId } });

    const missing = [
      ...schedules
        .filter((s) => !existing.some((i) => i.recurringId === s.id))
        .map((s) => ({ planId, source: PlanItemSource.RECURRING, recurringId: s.id })),
      ...categories
        .filter((c) => !existing.some((i) => i.category === c))
        .map((c) => ({ planId, source: PlanItemSource.CATEGORY, category: c })),
    ];

    if (missing.length === 0) {
      return existing;
    }

    await this.prisma.budgetPlanItem.createMany({ data: missing, skipDuplicates: true });

    return this.prisma.budgetPlanItem.findMany({ where: { planId } });
  }

  private async activePlan(userId: string): Promise<BudgetPlan | null> {
    return this.prisma.budgetPlan.findFirst({ where: { userId, archivedAt: null } });
  }
}
