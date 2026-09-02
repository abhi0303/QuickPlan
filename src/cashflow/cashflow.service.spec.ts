import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { CashflowService } from './cashflow.service';
import { PrismaService } from '../prisma/prisma.service';

const d = (v: number) => new Prisma.Decimal(v);

describe('CashflowService', () => {
  let service: CashflowService;

  const prisma = { $queryRaw: jest.fn() };

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
      providers: [CashflowService, { provide: PrismaService, useValue: prisma }],
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

    expect(Object.keys(prisma)).toEqual(['$queryRaw']);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(2);
  });
});
