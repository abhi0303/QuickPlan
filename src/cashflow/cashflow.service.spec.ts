import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CashflowService } from './cashflow.service';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from '../groups/groups.service';
import { GroupAccessService } from '../groups/group-access.service';

const d = (v: number) => new Prisma.Decimal(v);

describe('CashflowService', () => {
  let service: CashflowService;

  const prisma = {
    $queryRaw: jest.fn(),
    group: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const groups = { balancesFor: jest.fn() };
  const access = { memberGroupIds: jest.fn().mockResolvedValue([]) };

  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'e1',
    kind: 'GROUP_EXPENSE_PAID',
    at: new Date('2026-09-05T14:20:00Z'),
    direction: 'OUT',
    amount: d(3600),
    title: 'Dinner at Toit',
    category: 'Food',
    groupId: 'g1',
    groupName: 'Goa trip',
    myShare: d(900),
    counterpartyId: null,
    counterpartyName: null,
    ...over,
  });

  const answer = (rows: unknown[], out: number, inbound: number) => {
    prisma.$queryRaw
      .mockResolvedValueOnce(rows)
      .mockResolvedValueOnce([{ total: BigInt(rows.length), out: d(out), inbound: d(inbound) }]);
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CashflowService,
        { provide: PrismaService, useValue: prisma },
        { provide: GroupsService, useValue: groups },
        { provide: GroupAccessService, useValue: access },
      ],
    }).compile();
    service = module.get(CashflowService);
  });

  it('carries myShare beside the full amount, so one row renders both views', async () => {
    answer([row()], 3600, 0);

    const result = await service.list('u1');

    expect(result.items[0]).toMatchObject({
      kind: 'GROUP_EXPENSE_PAID',
      direction: 'OUT',
      amount: 3600,
      myShare: 900,
      groupName: 'Goa trip',
    });
  });

  it('nets inbound against outbound', async () => {
    answer([row()], 3600, 2700);

    const result = await service.list('u1');

    expect(result.totals).toEqual({ out: 3600, in: 2700, net: -900 });
  });

  it('names a settlement that has no note', async () => {
    answer(
      [
        row({
          id: 's1',
          kind: 'SETTLEMENT_PAID',
          direction: 'OUT',
          amount: d(900),
          title: null,
          myShare: null,
          counterpartyId: 'u2',
          counterpartyName: 'Manish Kumar',
        }),
      ],
      900,
      0,
    );

    const [item] = (await service.list('u1')).items;

    expect(item.title).toBe('Paid Manish Kumar');
    expect(item.counterparty).toEqual({ id: 'u2', name: 'Manish Kumar' });
  });

  it('names an inbound settlement from the other side', async () => {
    answer(
      [
        row({
          id: 's2',
          kind: 'SETTLEMENT_RECEIVED',
          direction: 'IN',
          amount: d(900),
          title: '   ',
          myShare: null,
          counterpartyId: 'u2',
          counterpartyName: 'Rishi',
        }),
      ],
      0,
      900,
    );

    expect((await service.list('u1')).items[0].title).toBe('Rishi paid you');
  });

  it('prefers the settlement note when there is one', async () => {
    answer(
      [row({ id: 's3', kind: 'SETTLEMENT_PAID', title: 'Dinner at Toit', counterpartyName: 'Rishi' })],
      900,
      0,
    );

    expect((await service.list('u1')).items[0].title).toBe('Dinner at Toit');
  });

  it('reports an empty ledger as zeroes rather than nulls', async () => {
    prisma.$queryRaw
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ total: BigInt(0), out: null, inbound: null }]);

    const result = await service.list('u1');

    expect(result.totals).toEqual({ out: 0, in: 0, net: 0 });
    expect(result.items).toEqual([]);
  });

  it('defaults the page size and offset', async () => {
    answer([], 0, 0);

    const result = await service.list('u1');

    expect(result.limit).toBe(50);
    expect(result.offset).toBe(0);
  });

  /**
   * Nothing is written. Mirroring group expenses into the personal table would
   * double-count every budget and analytic.
   */
  it('only ever reads', async () => {
    answer([row()], 3600, 0);

    await service.list('u1');

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });

  describe('outstanding', () => {
    const member = (userId: string, name: string, net: number) => ({
      userId,
      name,
      net,
      netDecimal: d(net),
    });

    it('is all zeroes for somebody in no groups', async () => {
      access.memberGroupIds.mockResolvedValue([]);

      expect(await service.outstanding('me')).toEqual({
        owedToYou: 0,
        youOwe: 0,
        net: 0,
        byGroup: [],
        byPerson: [],
      });
    });

    it('reports what each person owes when the user fronted the bill', async () => {
      access.memberGroupIds.mockResolvedValue(['g1']);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Goa trip' }]);
      groups.balancesFor.mockResolvedValue([
        member('me', 'Me', 2700),
        member('u2', 'Manish', -900),
        member('u3', 'Purvee', -900),
        member('u4', 'Rishi', -900),
      ]);

      const result = await service.outstanding('me');

      expect(result.owedToYou).toBe(2700);
      expect(result.youOwe).toBe(0);
      expect(result.byPerson.map((p) => [p.name, p.amount])).toEqual([
        ['Manish', 900],
        ['Purvee', 900],
        ['Rishi', 900],
      ]);
    });

    /** The point of netting per counterparty rather than per group. */
    it('nets one person across two groups into a single figure', async () => {
      access.memberGroupIds.mockResolvedValue(['g1', 'g2']);
      prisma.group.findMany.mockResolvedValue([
        { id: 'g1', name: 'Goa trip' },
        { id: 'g2', name: 'Flat' },
      ]);
      groups.balancesFor
        .mockResolvedValueOnce([member('me', 'Me', 900), member('u2', 'Manish', -900)])
        .mockResolvedValueOnce([member('me', 'Me', -600), member('u2', 'Manish', 600)]);

      const result = await service.outstanding('me');

      expect(result.byPerson).toEqual([{ userId: 'u2', name: 'Manish', amount: 300 }]);
      expect(result.owedToYou).toBe(300);
      expect(result.youOwe).toBe(0);
    });

    it('reports money the user owes as a negative against that person', async () => {
      access.memberGroupIds.mockResolvedValue(['g1']);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Flat' }]);
      groups.balancesFor.mockResolvedValue([
        member('me', 'Me', -600),
        member('u2', 'Manish', 600),
      ]);

      const result = await service.outstanding('me');

      expect(result.byPerson).toEqual([{ userId: 'u2', name: 'Manish', amount: -600 }]);
      expect(result.youOwe).toBe(600);
      expect(result.net).toBe(-600);
    });

    it('drops anybody who is square, and groups that are settled', async () => {
      access.memberGroupIds.mockResolvedValue(['g1']);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Goa trip' }]);
      groups.balancesFor.mockResolvedValue([
        member('me', 'Me', 0),
        member('u2', 'Manish', 0),
      ]);

      const result = await service.outstanding('me');

      expect(result.byPerson).toEqual([]);
      expect(result.byGroup).toEqual([]);
    });

    it('ignores debts between two other members', async () => {
      access.memberGroupIds.mockResolvedValue(['g1']);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Goa trip' }]);
      groups.balancesFor.mockResolvedValue([
        member('me', 'Me', 0),
        member('u2', 'Manish', 500),
        member('u3', 'Purvee', -500),
      ]);

      const result = await service.outstanding('me');

      expect(result.byPerson).toEqual([]);
      expect(result.owedToYou).toBe(0);
    });

    it('writes nothing', async () => {
      access.memberGroupIds.mockResolvedValue(['g1']);
      prisma.group.findMany.mockResolvedValue([{ id: 'g1', name: 'Goa trip' }]);
      groups.balancesFor.mockResolvedValue([
        member('me', 'Me', 900),
        member('u2', 'Manish', -900),
      ]);

      await service.outstanding('me');

      // Only reads: a debt is the balance between two people, and storing it
      // would be a second copy of a number expenses already determine.
      expect(prisma.group.findMany).toHaveBeenCalled();
      expect(Object.keys(prisma.group)).toEqual(['findMany']);
    });
  });
});