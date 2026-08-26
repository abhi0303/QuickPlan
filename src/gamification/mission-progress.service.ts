import { Injectable } from '@nestjs/common';
import { CreatedVia, MissionType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityKind } from './gamification.events';

/**
 * A recurring expense posts itself. Counting it would let rent complete "add 5
 * expenses" while the user did nothing, so missions only ever count what a
 * person actually entered.
 */
const NOT_SYSTEM = { createdVia: { not: CreatedVia.SYSTEM } } as const;

/**
 * Progress is measured against the underlying tables rather than incremented on
 * each event. That makes it idempotent for free: a retried request, a duplicate
 * event or two devices acting at once all converge on the same count, and a
 * deleted expense correctly takes its progress back.
 */
@Injectable()
export class MissionProgressService {
  constructor(private readonly prisma: PrismaService) {}

  /** Mission types an activity can move, so unrelated missions are never touched. */
  static typesFor(kind: ActivityKind): MissionType[] {
    switch (kind) {
      case 'EXPENSE_CREATED':
        return [
          MissionType.EXPENSE_COUNT,
          MissionType.EXPENSE_CATEGORY_COUNT,
          MissionType.EXPENSE_DAY_COUNT,
        ];
      case 'TASK_CREATED':
        return [MissionType.TASK_CREATE_COUNT, MissionType.TASK_CREATE_VOICE_COUNT];
      case 'TASK_COMPLETED':
        return [MissionType.TASK_COMPLETE_COUNT];
      case 'REMINDER_CREATED':
        return [MissionType.REMINDER_CREATE_COUNT, MissionType.REMINDER_CREATE_VOICE_COUNT];
      case 'REMINDER_COMPLETED':
        return [];
      default:
        return [];
    }
  }

  async measure(userId: string, type: MissionType, since: Date): Promise<number> {
    switch (type) {
      case MissionType.EXPENSE_COUNT:
        return this.prisma.expense.count({
          where: { createdById: userId, createdAt: { gte: since }, ...NOT_SYSTEM },
        });

      case MissionType.EXPENSE_CATEGORY_COUNT: {
        const rows = await this.prisma.expense.findMany({
          where: { createdById: userId, createdAt: { gte: since }, ...NOT_SYSTEM },
          select: { category: true },
          distinct: ['category'],
        });

        return rows.length;
      }

      case MissionType.EXPENSE_DAY_COUNT: {
        const rows = await this.prisma.expense.findMany({
          where: { createdById: userId, createdAt: { gte: since }, ...NOT_SYSTEM },
          select: { createdAt: true },
        });

        // Distinct calendar days in UTC - the same basis dueAt comparisons use.
        const days = new Set(rows.map((row) => row.createdAt.toISOString().slice(0, 10)));

        return days.size;
      }

      case MissionType.TASK_CREATE_COUNT:
        return this.prisma.task.count({ where: { userId, createdAt: { gte: since } } });

      case MissionType.TASK_CREATE_VOICE_COUNT:
        return this.prisma.task.count({
          where: { userId, createdAt: { gte: since }, createdVia: CreatedVia.VOICE },
        });

      case MissionType.TASK_COMPLETE_COUNT:
        return this.prisma.task.count({
          where: { userId, isCompleted: true, completedAt: { gte: since } },
        });

      case MissionType.REMINDER_CREATE_COUNT:
        return this.prisma.reminder.count({ where: { userId, createdAt: { gte: since } } });

      case MissionType.REMINDER_CREATE_VOICE_COUNT:
        return this.prisma.reminder.count({
          where: { userId, createdAt: { gte: since }, createdVia: CreatedVia.VOICE },
        });

      default:
        return 0;
    }
  }
}
