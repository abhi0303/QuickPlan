import { NotFoundException } from '@nestjs/common';
import { FriendsService } from './friends.service';

describe('FriendsService · unconfirmed and erased accounts', () => {
  const prisma = {
    user: { findMany: jest.fn(), findFirst: jest.fn(), findUnique: jest.fn() },
    friendship: { findMany: jest.fn(), findUnique: jest.fn(), upsert: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const emitter = { emitOne: jest.fn() };
  const service = new FriendsService(prisma as never, emitter as never);

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.user.findMany.mockResolvedValue([]);
    prisma.friendship.findMany.mockResolvedValue([]);
  });

  /** A half-finished signup is not a person you can add to a group. */
  it('leaves unconfirmed accounts out of search', async () => {
    await service.searchUsers('me', 'rahul');

    expect(prisma.user.findMany.mock.calls[0][0].where).toMatchObject({
      emailVerifiedAt: { not: null },
    });
  });

  it('leaves them out of the friend list too', async () => {
    await service.listFriends('me');

    expect(prisma.friendship.findMany.mock.calls[0][0].where).toEqual({
      userId: 'me',
      friend: { emailVerifiedAt: { not: null }, deletedAt: null },
    });
  });

  /**
   * The filter on search would be cosmetic if the endpoint behind it still
   * took the id. They are invisible, so 404 is the honest answer - and it
   * reveals nothing about who is registered.
   */
  it('refuses to add one even when the id is known', async () => {
    prisma.user.findFirst.mockResolvedValue(null);

    await expect(service.addFriend('me', 'unconfirmed-id')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.user.findFirst.mock.calls[0][0].where).toEqual({
      id: 'unconfirmed-id',
      emailVerifiedAt: { not: null },
      deletedAt: null,
    });
  });

  it('still adds a confirmed one', async () => {
    prisma.user.findFirst.mockResolvedValue({ id: 'them', name: 'Rahul', email: 'r@b.com' });
    prisma.friendship.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue({ name: 'Me' });

    expect(await service.addFriend('me', 'them')).toEqual({
      id: 'them',
      name: 'Rahul',
      email: 'r@b.com',
    });
    expect(prisma.$transaction).toHaveBeenCalled();
  });
});
