import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { CreatedVia } from '@prisma/client';
import { TasksService } from './tasks.service';
import { RemindersService } from '../reminders/reminders.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * The web client parses speech on-device and posts to the normal create
 * endpoints, so VOICE can only reach the server as a field on the body. Without
 * it every spoken task was recorded MANUAL and voice missions could never
 * complete.
 */
describe('createdVia on create', () => {
  const prisma = {
    task: { create: jest.fn(({ data }) => Promise.resolve({ id: 't1', ...data })) },
    reminder: { create: jest.fn(({ data }) => Promise.resolve({ id: 'r1', ...data })) },
  };
  const events = { emit: jest.fn() };

  let tasks: TasksService;
  let reminders: RemindersService;

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        RemindersService,
        { provide: PrismaService, useValue: prisma },
        { provide: EventEmitter2, useValue: events },
      ],
    }).compile();
    tasks = module.get(TasksService);
    reminders = module.get(RemindersService);
  });

  const dueAt = '2026-12-01T10:00:00.000Z';

  describe('tasks', () => {
    it('records VOICE when the body says so', async () => {
      await tasks.create('u1', { title: 'spoken', createdVia: CreatedVia.VOICE });

      expect(prisma.task.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.VOICE);
    });

    it('defaults to MANUAL when the field is omitted', async () => {
      await tasks.create('u1', { title: 'typed' });

      expect(prisma.task.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.MANUAL);
    });

    it('lets an internal caller override the body', async () => {
      // smart-input passes VOICE explicitly; a body claiming otherwise loses.
      await tasks.create('u1', { title: 'x', createdVia: CreatedVia.MANUAL }, CreatedVia.VOICE);

      expect(prisma.task.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.VOICE);
    });
  });

  describe('reminders', () => {
    it('records VOICE when the body says so', async () => {
      await reminders.create('u1', { title: 'spoken', dueAt, createdVia: CreatedVia.VOICE });

      expect(prisma.reminder.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.VOICE);
    });

    it('defaults to MANUAL when the field is omitted', async () => {
      await reminders.create('u1', { title: 'typed', dueAt });

      expect(prisma.reminder.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.MANUAL);
    });

    it('lets an internal caller override the body', async () => {
      await reminders.create(
        'u1',
        { title: 'x', dueAt, createdVia: CreatedVia.MANUAL },
        CreatedVia.VOICE,
      );

      expect(prisma.reminder.create.mock.calls[0][0].data.createdVia).toBe(CreatedVia.VOICE);
    });
  });
});
