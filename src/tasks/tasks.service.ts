import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreatedVia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_EVENT, ActivityEvent } from '../gamification/gamification.events';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  /**
   * `createdVia` comes from the caller, not the client body - the voice flow
   * passes VOICE, everything else defaults to MANUAL. It is what lets a
   * voice-only mission count the right tasks.
   */
  async create(userId: string, dto: CreateTaskDto, createdVia?: CreatedVia) {
    const completed = dto.isCompleted || false;
    // The explicit argument wins for internal callers such as smart-input; the
    // DTO field is how the web client reports its own on-device voice parsing.
    const via = createdVia ?? dto.createdVia ?? CreatedVia.MANUAL;

    const task = await this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        notes: dto.notes,
        status: dto.status || 'PENDING',
        priority: dto.priority || 'MEDIUM',
        category: dto.category || 'General',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        isCompleted: completed,
        completedAt: completed ? new Date() : null,
        createdVia: via,
      },
    });

    this.events.emit(ACTIVITY_EVENT, new ActivityEvent('TASK_CREATED', userId));

    if (completed) {
      this.events.emit(ACTIVITY_EVENT, new ActivityEvent('TASK_COMPLETED', userId));
    }

    return task;
  }

  async findAll(userId: string, filter?: { view?: string; category?: string; priority?: string }) {
    const now = new Date();
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

    const where: any = { userId };

    if (filter?.category) {
      where.category = filter.category;
    }

    if (filter?.priority) {
      where.priority = filter.priority;
    }

    if (filter?.view === 'today') {
      where.dueDate = {
        gte: startOfToday,
        lte: endOfToday,
      };
      where.isCompleted = false;
    } else if (filter?.view === 'upcoming') {
      where.dueDate = {
        gt: endOfToday,
      };
      where.isCompleted = false;
    } else if (filter?.view === 'overdue') {
      where.dueDate = {
        lt: startOfToday,
      };
      where.isCompleted = false;
    } else if (filter?.view === 'completed') {
      where.isCompleted = true;
    }

    return this.prisma.task.findMany({
      where,
      orderBy: { dueDate: 'asc' },
      include: {
        reminders: true,
      },
    });
  }

  async findOne(userId: string, id: string) {
    const task = await this.prisma.task.findFirst({
      where: { id, userId },
      include: { reminders: true },
    });

    if (!task) {
      throw new NotFoundException(`Task with ID ${id} not found`);
    }

    return task;
  }

  async update(userId: string, id: string, dto: UpdateTaskDto) {
    const existing = await this.findOne(userId, id);

    const data: any = { ...dto };
    if (dto.dueDate) {
      data.dueDate = new Date(dto.dueDate);
    }

    // Stamped on the first completion only, so re-saving a done task does not
    // move it into a later mission cycle.
    const justCompleted = dto.isCompleted === true && !existing.isCompleted;

    if (dto.isCompleted !== undefined) {
      data.status = dto.isCompleted ? 'COMPLETED' : 'PENDING';
      data.completedAt = dto.isCompleted ? existing.completedAt ?? new Date() : null;
    }

    const task = await this.prisma.task.update({ where: { id }, data });

    if (justCompleted) {
      this.events.emit(ACTIVITY_EVENT, new ActivityEvent('TASK_COMPLETED', userId));
    }

    return task;
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.task.delete({
      where: { id },
    });
  }
}
