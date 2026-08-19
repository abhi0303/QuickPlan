import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';

@Injectable()
export class TasksService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreateTaskDto) {
    return this.prisma.task.create({
      data: {
        userId,
        title: dto.title,
        notes: dto.notes,
        status: dto.status || 'PENDING',
        priority: dto.priority || 'MEDIUM',
        category: dto.category || 'General',
        dueDate: dto.dueDate ? new Date(dto.dueDate) : null,
        isCompleted: dto.isCompleted || false,
      },
    });
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
    await this.findOne(userId, id);

    const data: any = { ...dto };
    if (dto.dueDate) {
      data.dueDate = new Date(dto.dueDate);
    }

    if (dto.isCompleted !== undefined) {
      data.status = dto.isCompleted ? 'COMPLETED' : 'PENDING';
    }

    return this.prisma.task.update({
      where: { id },
      data,
    });
  }

  async remove(userId: string, id: string) {
    await this.findOne(userId, id);
    return this.prisma.task.delete({
      where: { id },
    });
  }
}
