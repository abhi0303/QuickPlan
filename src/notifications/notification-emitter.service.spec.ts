import { Test, TestingModule } from '@nestjs/testing';
import { NotificationType } from '@prisma/client';
import { NotificationEmitter } from './notification-emitter.service';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from './push.service';

describe('NotificationEmitter', () => {
  let emitter: NotificationEmitter;

  const prisma = {
    notification: {
      createManyAndReturn: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
    },
  };

  const push = { sendToUser: jest.fn().mockResolvedValue({ sent: 1, removed: 0, failed: 0 }) };

  const input = (userId: string, actorId = 'actor') => ({
    userId,
    type: NotificationType.GROUP_MEMBER_ADDED,
    title: 'Added to Goa trip',
    body: 'Abhinav added you to Goa trip.',
    url: '/groups/g1',
    actorId,
    groupId: 'g1',
    tag: 'group-g1',
    requireInteraction: false,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.notification.createManyAndReturn.mockImplementation(({ data }) =>
      Promise.resolve(
        data.map((d: any, i: number) => ({ ...d, id: `n${i}`, createdAt: new Date('2026-08-23T09:00:00Z') })),
      ),
    );
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        NotificationEmitter,
        { provide: PrismaService, useValue: prisma },
        { provide: PushService, useValue: push },
      ],
    }).compile();
    emitter = module.get(NotificationEmitter);
  });

  /** The single most common bug in this kind of feature. */
  it('never notifies the actor, even if a caller passes them in', async () => {
    await emitter.emit([input('actor'), input('u2')]);

    const written = prisma.notification.createManyAndReturn.mock.calls[0][0].data;
    expect(written).toHaveLength(1);
    expect(written[0].userId).toBe('u2');
  });

  it('writes one row per recipient', async () => {
    await emitter.emit([input('u2'), input('u3'), input('u4')]);

    expect(prisma.notification.createManyAndReturn.mock.calls[0][0].data).toHaveLength(3);
    expect(push.sendToUser).toHaveBeenCalledTimes(3);
  });

  it('carries notificationId and type in the push data so a tap can mark it read', async () => {
    await emitter.emit([input('u2')]);

    const payload = push.sendToUser.mock.calls[0][1];
    expect(payload).toMatchObject({
      title: 'Added to Goa trip',
      url: '/groups/g1',
      tag: 'group-g1',
      requireInteraction: false,
      data: { type: 'GROUP_MEMBER_ADDED', notificationId: 'n0', groupId: 'g1' },
    });
  });

  it('stamps pushedAt only when a device actually received it', async () => {
    push.sendToUser.mockResolvedValueOnce({ sent: 0, removed: 0, failed: 0 });
    await emitter.emit([input('u2')]);
    expect(prisma.notification.update).not.toHaveBeenCalled();

    push.sendToUser.mockResolvedValueOnce({ sent: 2, removed: 0, failed: 0 });
    await emitter.emit([input('u3')]);
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: 'n0' },
      data: { pushedAt: expect.any(Date) },
    });
  });

  it('still writes the feed row for a user with no push subscription', async () => {
    push.sendToUser.mockResolvedValue({ sent: 0, removed: 0, failed: 0 });

    await emitter.emit([input('u2')]);

    expect(prisma.notification.createManyAndReturn).toHaveBeenCalled();
  });

  /** A notification failure must not fail the action that caused it. */
  it('swallows a write failure instead of breaking the caller', async () => {
    prisma.notification.createManyAndReturn.mockRejectedValue(new Error('db down'));

    await expect(emitter.emit([input('u2')])).resolves.toBeUndefined();
  });

  it('does nothing when the recipient list is empty', async () => {
    await emitter.emit([]);

    expect(prisma.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(push.sendToUser).not.toHaveBeenCalled();
  });
});
