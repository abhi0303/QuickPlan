import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserService } from './user.service';

describe('UserService · deleteAccount', () => {
  const tables = [
    'expense', 'task', 'reminder', 'budget', 'budgetPlan', 'recurringExpense',
    'pushSubscription', 'userMission', 'idempotencyKey', 'passwordResetToken',
    'emailVerificationToken', 'friendship', 'notification',
  ] as const;

  const prisma: Record<string, unknown> = {
    user: { findUnique: jest.fn(), update: jest.fn() },
    $transaction: jest.fn().mockResolvedValue([]),
  };
  for (const t of tables) prisma[t] = { deleteMany: jest.fn((args: unknown) => args) };

  const onboarding = { ensure: jest.fn(), state: jest.fn() };
  const service = new UserService(prisma as never, onboarding as never);
  const ALIVE = { id: 'u1', email: 'a@b.com', passwordHash: 'stored', deletedAt: null };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction = jest.fn().mockResolvedValue([]);
  });

  const args = (table: string) =>
    (prisma[table] as { deleteMany: jest.Mock }).deleteMany.mock.calls[0]?.[0];

  it('refuses a wrong password and deletes nothing', async () => {
    (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(ALIVE);
    jest.spyOn(service, 'verifyPassword').mockResolvedValue(false);

    await expect(service.deleteAccount('u1', 'wrong')).rejects.toThrow(UnauthorizedException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('refuses an account already erased', async () => {
    (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue({
      ...ALIVE, deletedAt: new Date(),
    });

    await expect(service.deleteAccount('u1', 'password123')).rejects.toThrow(NotFoundException);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  describe('with the right password', () => {
    beforeEach(async () => {
      (prisma.user as { findUnique: jest.Mock }).findUnique.mockResolvedValue(ALIVE);
      jest.spyOn(service, 'verifyPassword').mockResolvedValue(true);
      await service.deleteAccount('u1', 'password123');
    });

    /**
     * The whole point of the tombstone: deleting group rows would silently
     * rewrite other members' balances.
     */
    it('deletes only the personal ledger, never group expenses', () => {
      expect(args('expense')).toEqual({ where: { ownerId: 'u1', scope: 'PERSONAL' } });
    });

    it('leaves both directions of every friendship gone', () => {
      expect(args('friendship')).toEqual({
        where: { OR: [{ userId: 'u1' }, { friendId: 'u1' }] },
      });
    });

    /** Their name is written into the body of other people's notifications. */
    it('removes notifications naming them, not just their own', () => {
      expect(args('notification')).toEqual({
        where: { OR: [{ userId: 'u1' }, { actorId: 'u1' }] },
      });
    });

    it('stops recurring expenses so nothing keeps writing after they leave', () => {
      expect(args('recurringExpense')).toEqual({ where: { userId: 'u1' } });
    });

    it('tombstones the row instead of deleting it', () => {
      const { where, data } = (prisma.user as { update: jest.Mock }).update.mock.calls[0][0];

      expect(where).toEqual({ id: 'u1' });
      expect(data).toMatchObject({
        name: 'Removed user',
        email: 'deleted-u1@removed.invalid',
        passwordHash: null,
        emailVerifiedAt: null,
        upiIds: [],
      });
      expect(data.deletedAt).toBeInstanceOf(Date);
      // Ends sessions that are still open, the same as a password reset.
      expect(data.passwordChangedAt).toBeInstanceOf(Date);
    });

    it('does it all in one transaction', () => {
      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    });
  });
});
