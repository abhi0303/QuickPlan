import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Injectable()
export class RemindersService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateReminderDto) {
    const dueAt = new Date(dto.dueAt);
    const offset = dto.offsetMinutes || 0;

    // Calculate actual trigger date taking offset into account (e.g. 30 min before dueAt)
    const triggerAt = new Date(dueAt.getTime() - offset * 60 * 1000);

    return this.prisma.reminder.create({
      data: {
        userId,
        taskId: dto.taskId || null,
        title: dto.title,
        dueAt: triggerAt,
        offsetMinutes: offset,
        recurrenceRule: dto.recurrenceRule || null,
        status: 'PENDING',
      },
    });
  }

  async findAll(userId: string) {
    return this.prisma.reminder.findMany({
      where: { userId },
      orderBy: { dueAt: 'asc' },
      include: { task: true },
    });
  }

  async remove(userId: string, id: string) {
    const reminder = await this.prisma.reminder.findFirst({
      where: { id, userId },
    });

    if (!reminder) {
      throw new NotFoundException(`Reminder with ID ${id} not found`);
    }

    return this.prisma.reminder.delete({
      where: { id },
    });
  }

  async findDueReminders() {
    const now = new Date();
    return this.prisma.reminder.findMany({
      where: {
        dueAt: { lte: now },
        pushSent: false,
        status: 'PENDING',
      },
      include: { user: true },
    });
  }

  async markAsSent(id: string) {
    return this.prisma.reminder.update({
      where: { id },
      data: { pushSent: true, status: 'SENT' },
    });
  }
}
