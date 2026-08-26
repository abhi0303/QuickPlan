import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  Budget,
  BudgetPeriod,
  BudgetScope,
  BudgetStatus,
  ExpenseScope,
  NotificationType,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import { formatMoney, toDecimal, toNumber, ZERO } from '../common/money';
import {
  PeriodWindow,
  periodKey,
  project,
  resolveWindow,
  round2,
  statusFor,
} from './period';
import { CreateBudgetDto, UpdateBudgetDto } from './dto/budget.dto';

const STATUS_RANK: Record<BudgetStatus, number> = {
  ON_TRACK: 0,
  WARNING: 1,
  EXCEEDED: 2,
};

@Injectable()
export class BudgetsService {
  private readonly logger = new Logger(BudgetsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly emitter: NotificationEmitter,
  ) {}

  // ------------------------------------------------------------------
  // CRUD
  // ------------------------------------------------------------------

  async list(userId: string) {
    const budgets = await this.prisma.budget.findMany({
      where: { userId, archivedAt: null },
      orderBy: [{ category: 'asc' }],
    });

    return budgets.map((budget) => this.present(budget));
  }

  async create(userId: string, dto: CreateBudgetDto) {
    const period = dto.period ?? BudgetPeriod.MONTHLY;

    try {
      const budget = await this.prisma.budget.create({
        data: {
          userId,
          category: dto.category ?? null,
          amount: toDecimal(dto.amount),
          period,
          scope: dto.scope ?? BudgetScope.PERSONAL,
          startsOn: dto.startsOn ? new Date(dto.startsOn) : new Date(),
        },
      });

      return this.present(budget);
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw new ConflictException(
          dto.category
            ? `A ${period.toLowerCase()} budget for ${dto.category} already exists.`
            : `An overall ${period.toLowerCase()} budget already exists.`,
        );
      }

      throw error;
    }
  }

  async update(userId: string, id: string, dto: UpdateBudgetDto) {
    await this.requireOwn(userId, id);

    const budget = await this.prisma.budget.update({
      where: { id },
      data: {
        ...(dto.amount !== undefined ? { amount: toDecimal(dto.amount) } : {}),
        ...(dto.scope !== undefined ? { scope: dto.scope } : {}),
      },
    });

    return this.present(budget);
  }

  /**
   * Archived, not deleted. A budget removed in March must not rewrite what
   * February looked like - historic periods keep the limit that was in force.
   */
  async archive(userId: string, id: string) {
    const existing = await this.requireOwn(userId, id);

    if (existing.archivedAt) {
      return this.present(existing);
    }

    const budget = await this.prisma.budget.update({
      where: { id },
      data: { archivedAt: new Date() },
    });

    return this.present(budget);
  }

  // ------------------------------------------------------------------
  // Status
  // ------------------------------------------------------------------

  /**
   * Everything the rings need, computed server-side so the client cannot
   * disagree about who is over budget.
   */
  async status(userId: string, key?: string, periodType: BudgetPeriod = BudgetPeriod.MONTHLY) {
    const window = resolveWindow(key, periodType);

    const budgets = await this.prisma.budget.findMany({
      where: {
        userId,
        period: periodType,
        startsOn: { lte: window.to },
        // A budget archived mid-period still governed that period.
        OR: [{ archivedAt: null }, { archivedAt: { gte: window.from } }],
      },
    });

    const spendByCategory = await this.spendByCategory(userId, window, budgets);

    const overallBudget = budgets.find((b) => b.category === null);
    const categoryBudgets = budgets.filter((b) => b.category !== null);

    const totalSpent = [...spendByCategory.values()].reduce((sum, v) => sum + v, 0);

    const categories = categoryBudgets.map((budget) =>
      this.line(budget, spendByCategory.get(budget.category as string) ?? 0, window),
    );

    const budgetedCategories = new Set(categoryBudgets.map((b) => b.category));

    return {
      period: {
        key: window.key,
        from: window.from,
        to: window.to,
        daysElapsed: window.daysElapsed,
        daysTotal: window.daysTotal,
      },
      overall: overallBudget ? this.line(overallBudget, totalSpent, window) : null,
      categories,
      // Categories with real spending and no budget - how someone discovers the
      // budget they should have set.
      unbudgeted: [...spendByCategory.entries()]
        .filter(([category, spent]) => !budgetedCategories.has(category) && spent > 0)
        .map(([category, spent]) => ({ category, spent: round2(spent) }))
        .sort((a, b) => b.spent - a.spent),
    };
  }

  private line(budget: Budget, spent: number, window: PeriodWindow) {
    const amount = toNumber(budget.amount);
    const percentage = amount > 0 ? round2((spent / amount) * 100) : 0;

    return {
      budgetId: budget.id,
      category: budget.category,
      scope: budget.scope,
      amount,
      spent: round2(spent),
      remaining: round2(amount - spent),
      percentage,
      projected: project(spent, window),
      status: statusFor(percentage),
    };
  }

  /**
   * Personal expenses always count. A budget scoped ALL also counts the user's
   * share of group expenses, which is what actually left their money.
   */
  private async spendByCategory(
    userId: string,
    window: PeriodWindow,
    budgets: Budget[],
  ): Promise<Map<string, number>> {
    const wantsGroups = budgets.some((b) => b.scope === BudgetScope.ALL);
    const totals = new Map<string, number>();

    const personal = await this.prisma.expense.groupBy({
      by: ['category'],
      where: {
        scope: ExpenseScope.PERSONAL,
        ownerId: userId,
        date: { gte: window.from, lte: window.to },
      },
      _sum: { totalAmount: true },
    });

    for (const row of personal) {
      totals.set(row.category, toNumber(row._sum.totalAmount));
    }

    if (!wantsGroups) {
      return totals;
    }

    const shares = await this.prisma.expenseShare.findMany({
      where: {
        userId,
        expense: {
          scope: ExpenseScope.GROUP,
          date: { gte: window.from, lte: window.to },
        },
      },
      select: { amount: true, expense: { select: { category: true } } },
    });

    // Only fold group spending into the categories whose budget asked for it.
    const allScopeCategories = new Set(
      budgets.filter((b) => b.scope === BudgetScope.ALL).map((b) => b.category),
    );
    const overallIsAll = allScopeCategories.has(null);

    for (const share of shares) {
      const category = share.expense.category;

      if (!overallIsAll && !allScopeCategories.has(category)) {
        continue;
      }

      totals.set(category, (totals.get(category) ?? 0) + toNumber(share.amount));
    }

    return totals;
  }

  /**
   * Nobody knows what their food budget should be; everybody recognises last
   * period's number.
   */
  async suggest(userId: string, category?: string, period: BudgetPeriod = BudgetPeriod.MONTHLY) {
    const now = new Date();
    const previous =
      period === BudgetPeriod.WEEKLY
        ? new Date(now.getTime() - 7 * 86400000)
        : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 15));

    const window = resolveWindow(periodKey(previous, period), period, now);

    const rows = await this.prisma.expense.groupBy({
      by: ['category'],
      where: {
        scope: ExpenseScope.PERSONAL,
        ownerId: userId,
        date: { gte: window.from, lte: window.to },
        ...(category ? { category } : {}),
      },
      _sum: { totalAmount: true },
    });

    const total = rows.reduce((sum, row) => sum + toNumber(row._sum.totalAmount), 0);

    return {
      basedOn: window.key,
      category: category ?? null,
      suggestedAmount: round2(total),
      breakdown: rows
        .map((row) => ({ category: row.category, spent: round2(toNumber(row._sum.totalAmount)) }))
        .sort((a, b) => b.spent - a.spent),
    };
  }

  // ------------------------------------------------------------------
  // Alerts
  // ------------------------------------------------------------------

  /**
   * Fires only on a transition upward, once per budget per period. Alerting on
   * every expense past 80% is how people turn notifications off.
   */
  async evaluateAlerts(userId: string, now = new Date()): Promise<void> {
    try {
      for (const periodType of [BudgetPeriod.MONTHLY, BudgetPeriod.WEEKLY]) {
        const snapshot = await this.status(userId, undefined, periodType);
        const lines = [snapshot.overall, ...snapshot.categories].filter(Boolean);

        for (const line of lines) {
          if (line.status === BudgetStatus.ON_TRACK) {
            continue;
          }

          const alert = await this.prisma.budgetPeriodAlert.findUnique({
            where: {
              budgetId_periodKey: { budgetId: line.budgetId, periodKey: snapshot.period.key },
            },
          });

          if (alert && STATUS_RANK[alert.lastStatus] >= STATUS_RANK[line.status]) {
            continue;
          }

          await this.prisma.budgetPeriodAlert.upsert({
            where: {
              budgetId_periodKey: { budgetId: line.budgetId, periodKey: snapshot.period.key },
            },
            update: { lastStatus: line.status },
            create: {
              budgetId: line.budgetId,
              periodKey: snapshot.period.key,
              lastStatus: line.status,
            },
          });

          await this.emitter.emitOne(this.alertFor(userId, line, snapshot.period));
        }
      }
    } catch (error) {
      // A budget alert must never break the expense that triggered it.
      this.logger.error(
        `Budget alerts for ${userId} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private alertFor(
    userId: string,
    line: { budgetId: string; category: string | null; amount: number; spent: number; remaining: number; percentage: number; status: BudgetStatus },
    period: { key: string; daysTotal: number; daysElapsed: number },
  ) {
    const label = line.category ?? 'Overall spending';
    const daysLeft = Math.max(0, period.daysTotal - period.daysElapsed);
    const exceeded = line.status === BudgetStatus.EXCEEDED;

    return {
      userId,
      type: exceeded ? NotificationType.BUDGET_EXCEEDED : NotificationType.BUDGET_WARNING,
      title: exceeded ? `${label} over budget` : `${label} at ${Math.round(line.percentage)}%`,
      body: exceeded
        ? `${label} is ${formatMoney(Math.abs(line.remaining))} over budget this period.`
        : `${label} is at ${Math.round(line.percentage)}% — ${formatMoney(line.remaining)} left with ${daysLeft} day${daysLeft === 1 ? '' : 's'} to go.`,
      url: '/money',
      entityId: line.budgetId,
      data: { periodKey: period.key, percentage: line.percentage, category: line.category },
      // One tag per budget per period, so a warning followed by an exceeded
      // replaces the banner rather than stacking two.
      tag: `budget-${line.budgetId}-${period.key}`,
      requireInteraction: false,
    };
  }

  private async requireOwn(userId: string, id: string): Promise<Budget> {
    const budget = await this.prisma.budget.findFirst({ where: { id, userId } });

    if (!budget) {
      throw new NotFoundException(`Budget ${id} not found`);
    }

    return budget;
  }

  private present(budget: Budget) {
    return { ...budget, amount: toNumber(budget.amount) };
  }
}
