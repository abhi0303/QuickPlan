import { Test, TestingModule } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { RemindersService } from '../reminders/reminders.service';
import { PushService } from './push.service';

describe('NotificationsService scheduler', () => {
  let service: NotificationsService;

  const push = { sendToUser: jest.fn().mockResolvedValue({ sent: 1, removed: 0, failed: 0 }), isEnabled: () => true };
  const reminders = {
    findDueReminders: jest.fn(),
    markLeadSent: jest.fn(),
    markDueSent: jest.fn(),
  };
  const prisma = { pushSubscription: { upsert: jest.fn(), deleteMany: jest.fn() } };

  const reminder = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'rmd-1',
    userId: 'user-1',
    title: 'Call Rahul',
    dueAt: new Date('2026-08-21T10:00:00Z'),
    offsetMinutes: 30,
    sentLeadAt: null,
    sentDueAt: null,
    recurrenceRule: null,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RemindersService, useValue: reminders },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    service = module.get(NotificationsService);
  });

  const runAt = async (iso: string) => {
    jest.useFakeTimers().setSystemTime(new Date(iso));
    await service.handleCronReminders();
    jest.useRealTimers();
  };

  it('sends the lead-in alert once its moment arrives', async () => {
    reminders.findDueReminders.mockResolvedValue([reminder()]);
    await runAt('2026-08-21T09:30:00Z');

    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser.mock.calls[0][1]).toMatchObject({
      title: 'Call Rahul',
      tag: 'reminder-rmd-1',
      data: { reminderId: 'rmd-1', moment: 'LEAD' },
    });
    expect(reminders.markLeadSent).toHaveBeenCalledWith('rmd-1', expect.any(Date));
    expect(reminders.markDueSent).not.toHaveBeenCalled();
  });

  it('does not resend a lead-in that already went out', async () => {
    reminders.findDueReminders.mockResolvedValue([
      reminder({ sentLeadAt: new Date('2026-08-21T09:30:00Z') }),
    ]);
    await runAt('2026-08-21T09:45:00Z');

    expect(push.sendToUser).not.toHaveBeenCalled();
    expect(reminders.markLeadSent).not.toHaveBeenCalled();
  });

  it('sends the due alert at the due moment', async () => {
    reminders.findDueReminders.mockResolvedValue([
      reminder({ sentLeadAt: new Date('2026-08-21T09:30:00Z') }),
    ]);
    await runAt('2026-08-21T10:00:00Z');

    expect(push.sendToUser.mock.calls[0][1]).toMatchObject({
      data: { reminderId: 'rmd-1', moment: 'DUE' },
      requireInteraction: true,
    });
    expect(reminders.markDueSent).toHaveBeenCalledWith('rmd-1', expect.any(Date));
  });

  it('sends only the due alert when both moments have already passed', async () => {
    reminders.findDueReminders.mockResolvedValue([reminder()]);
    await runAt('2026-08-21T11:00:00Z');

    expect(push.sendToUser).toHaveBeenCalledTimes(1);
    expect(push.sendToUser.mock.calls[0][1].data.moment).toBe('DUE');
    expect(reminders.markLeadSent).not.toHaveBeenCalled();
  });

  it('skips the lead-in entirely when there is no offset', async () => {
    reminders.findDueReminders.mockResolvedValue([reminder({ offsetMinutes: 0 })]);
    await runAt('2026-08-21T09:45:00Z');

    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('does nothing when no reminder is due', async () => {
    reminders.findDueReminders.mockResolvedValue([]);
    await runAt('2026-08-21T08:00:00Z');

    expect(push.sendToUser).not.toHaveBeenCalled();
  });

  it('upserts a subscription on endpoint so reloads do not duplicate rows', async () => {
    await service.saveSubscription('user-1', {
      endpoint: 'https://push.example/abc',
      p256dh: 'key',
      auth: 'secret',
    });

    expect(prisma.pushSubscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { endpoint: 'https://push.example/abc' } }),
    );
  });

  it('only removes a subscription belonging to the caller', async () => {
    prisma.pushSubscription.deleteMany.mockResolvedValue({ count: 1 });
    const result = await service.removeSubscription('user-1', 'https://push.example/abc');

    expect(prisma.pushSubscription.deleteMany).toHaveBeenCalledWith({
      where: { endpoint: 'https://push.example/abc', userId: 'user-1' },
    });
    expect(result).toEqual({ removed: 1 });
  });
});
