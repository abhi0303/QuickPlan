import { Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreatedVia } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ACTIVITY_EVENT, ActivityEvent } from '../gamification/gamification.events';
import { CreateReminderDto } from './dto/create-reminder.dto';
import { UpdateReminderDto } from './dto/update-reminder.dto';
import { leadTime, nextOccurrence } from './recurrence';

@Injectable()
export class RemindersService {
  constructor(
    private prisma: PrismaService,
    private events: EventEmitter2,
  ) {}

  /**
   * dueAt is stored as the moment the reminder is for. It used to be saved
   * already reduced by offsetMinutes, which meant the API reported the lead-in
   * time as the due time and left no way to alert at both moments.
   */
  async create(userId: string, dto: CreateReminderDto, createdVia?: CreatedVia) {
    // The explicit argument wins for internal callers such as smart-input; the
    // DTO field is how the web client reports its own on-device voice parsing.
    const via = createdVia ?? dto.createdVia ?? CreatedVia.MANUAL;

    const reminder = await this.prisma.reminder.create({
      data: {
        userId,
        taskId: dto.taskId || null,
        title: dto.title,
        dueAt: new Date(dto.dueAt),
        offsetMinutes: dto.offsetMinutes || 0,
        recurrenceRule: dto.recurrenceRule || null,
        status: 'PENDING',
        createdVia: via,
      },
    });

    this.events.emit(ACTIVITY_EVENT, new ActivityEvent('REMINDER_CREATED', userId));

    return reminder;
  }

  /**
   * Editing used to mean delete-then-create, which changed the reminder's id
   * on every save. Any change to timing clears the sent markers so the new
   * schedule can still alert.
   */
  async update(userId: string, id: string, dto: UpdateReminderDto) {
    const reminder = await this.prisma.reminder.findFirst({ where: { id, userId } });

    if (!reminder) {
      throw new NotFoundException(`Reminder with ID ${id} not found`);
    }

    const reschedules =
      (dto.dueAt !== undefined && new Date(dto.dueAt).getTime() !== reminder.dueAt.getTime()) ||
      (dto.offsetMinutes !== undefined && dto.offsetMinutes !== reminder.offsetMinutes);

    return this.prisma.reminder.update({
      where: { id },
      data: {
        ...(dto.title !== undefined ? { title: dto.title } : {}),
        ...(dto.dueAt !== undefined ? { dueAt: new Date(dto.dueAt) } : {}),
        ...(dto.offsetMinutes !== undefined ? { offsetMinutes: dto.offsetMinutes } : {}),
        ...(dto.recurrenceRule !== undefined ? { recurrenceRule: dto.recurrenceRule } : {}),
        ...(dto.taskId !== undefined ? { taskId: dto.taskId } : {}),
        ...(reschedules
          ? { sentLeadAt: null, sentDueAt: null, pushSent: false, status: 'PENDING' }
          : {}),
      },
      include: { task: true },
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

  /**
   * Candidates for either alert. A reminder is picked up when its lead-in or
   * its due moment has arrived and that moment has not already been sent.
   * `sentLeadAt`/`sentDueAt` are what stop a restart resending everything and
   * stop a passed reminder firing on every tick.
   */
  async findDueReminders(now: Date = new Date()) {
    return this.prisma.reminder.findMany({
      where: {
        status: { in: ['PENDING', 'LEAD_SENT'] },
        OR: [
          { sentDueAt: null, dueAt: { lte: now } },
          { sentLeadAt: null, offsetMinutes: { gt: 0 } },
        ],
      },
      orderBy: { dueAt: 'asc' },
    });
  }

  async markLeadSent(id: string, at: Date = new Date()) {
    return this.prisma.reminder.update({
      where: { id },
      data: { sentLeadAt: at, status: 'LEAD_SENT' },
    });
  }

  /**
   * For a recurring reminder the due alert rolls the schedule forward and
   * clears both markers; otherwise the reminder is finished.
   */
  async markDueSent(id: string, at: Date = new Date()) {
    const reminder = await this.prisma.reminder.findUnique({ where: { id } });

    if (!reminder) {
      return null;
    }

    const next = nextOccurrence(reminder.dueAt, reminder.recurrenceRule, at);

    if (next) {
      return this.prisma.reminder.update({
        where: { id },
        data: {
          dueAt: next,
          sentLeadAt: null,
          sentDueAt: null,
          pushSent: false,
          status: 'PENDING',
        },
      });
    }

    return this.prisma.reminder.update({
      where: { id },
      data: { sentDueAt: at, pushSent: true, status: 'SENT' },
    });
  }

  /** Kept for callers that only care that something was delivered. */
  async markAsSent(id: string) {
    return this.markDueSent(id);
  }

  leadTimeFor(dueAt: Date, offsetMinutes: number): Date {
    return leadTime(dueAt, offsetMinutes);
  }
}
