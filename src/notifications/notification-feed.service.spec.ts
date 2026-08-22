import { Test, TestingModule } from '@nestjs/testing';
import { NotificationFeedService } from './notification-feed.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationStatus } from './dto/query-notifications.dto';

describe('NotificationFeedService', () => {
  let service: NotificationFeedService;

  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  };

  const row = (i: number) => ({
    id: `n${i}`,
    type: 'FRIEND_ADDED',
    title: 't',
    body: 'b',
    url: '/people',
    actor: { id: 'u2', name: 'Bala' },
    groupId: null,
    entityId: null,
    data: null,
    readAt: null,
    createdAt: new Date(`2026-08-2${i}T10:00:00Z`),
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.notification.count.mockResolvedValue(0);
    const module: TestingModule = await Test.createTestingModule({
      providers: [NotificationFeedService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(NotificationFeedService);
  });

  it('returns no cursor when the page is not full', async () => {
    prisma.notification.findMany.mockResolvedValue([row(1), row(2)]);

    const result = await service.list('u1', { limit: 20 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toBeNull();
  });

  it('trims the lookahead row and issues a cursor when more exist', async () => {
    // Asks for limit + 1 to detect a next page without a second count query.
    prisma.notification.findMany.mockResolvedValue([row(1), row(2), row(3)]);

    const result = await service.list('u1', { limit: 2 });

    expect(prisma.notification.findMany.mock.calls[0][0].take).toBe(3);
    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).toEqual(expect.any(String));
  });

  it('round-trips the cursor into a keyset predicate', async () => {
    prisma.notification.findMany.mockResolvedValue([row(1), row(2), row(3)]);
    const first = await service.list('u1', { limit: 2 });

    await service.list('u1', { limit: 2, cursor: first.nextCursor as string });

    // Tie-broken on id so two rows sharing a timestamp cannot repeat or vanish.
    const where = prisma.notification.findMany.mock.calls[1][0].where;
    expect(where.OR).toEqual([
      { createdAt: { lt: expect.any(Date) } },
      { createdAt: expect.any(Date), id: { lt: 'n2' } },
    ]);
  });

  it('starts from the top when the cursor is malformed', async () => {
    prisma.notification.findMany.mockResolvedValue([]);

    await service.list('u1', { cursor: 'not-base64-json' });

    expect(prisma.notification.findMany.mock.calls[0][0].where.OR).toBeUndefined();
  });

  it('filters to unread when asked', async () => {
    await service.list('u1', { status: NotificationStatus.UNREAD });

    expect(prisma.notification.findMany.mock.calls[0][0].where.readAt).toBeNull();
  });

  it('reports the total unread, not the page count', async () => {
    prisma.notification.findMany.mockResolvedValue([row(1)]);
    prisma.notification.count.mockResolvedValue(17);

    const result = await service.list('u1', { limit: 1 });

    expect(result.unreadCount).toBe(17);
  });

  it('marks only the listed ids, and only unread ones', async () => {
    await service.markRead('u1', { ids: ['n1', 'n2'] });

    expect(prisma.notification.updateMany).toHaveBeenCalledWith({
      where: { userId: 'u1', readAt: null, id: { in: ['n1', 'n2'] } },
      data: { readAt: expect.any(Date) },
    });
  });

  it('marks everything when all is set', async () => {
    await service.markRead('u1', { all: true });

    expect(prisma.notification.updateMany.mock.calls[0][0].where).toEqual({
      userId: 'u1',
      readAt: null,
    });
  });

  it('scopes deletion to the caller', async () => {
    await service.remove('u1', 'n1');

    expect(prisma.notification.deleteMany).toHaveBeenCalledWith({
      where: { id: 'n1', userId: 'u1' },
    });
  });
});
