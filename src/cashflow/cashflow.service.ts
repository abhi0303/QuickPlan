import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupsService } from '../groups/groups.service';
import { GroupAccessService } from '../groups/group-access.service';
import { suggestSettlements, toNumber } from '../common/money';
import { QueryCashflowDto } from './dto/cashflow.dto';

interface MovementRow {
  id: string;
  kind: 'PERSONAL_EXPENSE' | 'GROUP_EXPENSE_PAID' | 'SETTLEMENT_PAID' | 'SETTLEMENT_RECEIVED';
  at: Date;
  direction: 'IN' | 'OUT';
  amount: Prisma.Decimal;
  title: string | null;
  category: string | null;
  groupId: string | null;
  groupName: string | null;
  myShare: Prisma.Decimal | null;
  counterpartyId: string | null;
  counterpartyName: string | null;
}

/**
 * Cash flow answers "what left my account", which is a different question from
 * "what did this cost me". A 3,600 dinner split four ways costs 900 and takes
 * 3,600 out on the night.
 *
 * Nothing here is stored. Mirroring group expenses into the personal table is
 * the obvious implementation and it double-counts immediately: the list would
 * return both rows, analytics would add the share and the full amount, and
 * every budget would be wrong by the size of the user's group activity. This is
 * a view over data that already exists.
 */
@Injectable()
export class CashflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly groups: GroupsService,
    private readonly access: GroupAccessService,
  ) {}

  /**
   * How much of the user's money is currently out with other people, and with
   * whom - the one number a group app never tells you.
   *
   * Derived from the same balances the group view already computes, netted per
   * counterparty across every group. Nothing is stored: a debt is the balance
   * between two people, and storing it would mean keeping a second copy of a
   * number that expenses and settlements already determine.
   */
  async outstanding(userId: string) {
    const groupIds = await this.access.memberGroupIds(userId);

    if (groupIds.length === 0) {
      return { owedToYou: 0, youOwe: 0, net: 0, byGroup: [], byPerson: [] };
    }

    const byPerson = new Map<string, { userId: string; name: string | null; amount: number }>();
    const byGroup: Array<{ groupId: string; groupName: string | null; net: number }> = [];

    const groups = await this.prisma.group.findMany({
      where: { id: { in: groupIds } },
      select: { id: true, name: true },
    });
    const nameOf = new Map(groups.map((g) => [g.id, g.name]));

    for (const groupId of groupIds) {
      const balances = await this.groups.balancesFor(groupId);
      const mine = balances.find((b) => b.userId === userId);

      byGroup.push({
        groupId,
        groupName: nameOf.get(groupId) ?? null,
        net: mine?.net ?? 0,
      });

      // The same greedy matching the group view shows as "settle up", so the
      // per-person figures here and the suggestions there cannot disagree.
      const transfers = suggestSettlements(
        balances.map((b) => ({ userId: b.userId, net: b.netDecimal as never })),
      );

      for (const transfer of transfers) {
        const involvesMe = transfer.fromUserId === userId || transfer.toUserId === userId;

        if (!involvesMe) {
          continue;
        }

        const owedToMe = transfer.toUserId === userId;
        const otherId = owedToMe ? transfer.fromUserId : transfer.toUserId;
        const other = balances.find((b) => b.userId === otherId);
        const signed = toNumber(transfer.amount) * (owedToMe ? 1 : -1);
        const current = byPerson.get(otherId);

        byPerson.set(otherId, {
          userId: otherId,
          name: other?.name ?? null,
          amount: Number(((current?.amount ?? 0) + signed).toFixed(2)),
        });
      }
    }

    const people = [...byPerson.values()].filter((p) => p.amount !== 0);
    const owedToYou = Number(
      people.filter((p) => p.amount > 0).reduce((sum, p) => sum + p.amount, 0).toFixed(2),
    );
    const youOwe = Number(
      people.filter((p) => p.amount < 0).reduce((sum, p) => sum - p.amount, 0).toFixed(2),
    );

    return {
      owedToYou,
      youOwe,
      net: Number((owedToYou - youOwe).toFixed(2)),
      byGroup: byGroup.filter((g) => g.net !== 0).sort((a, b) => b.net - a.net),
      // Positive means they owe you; negative means you owe them.
      byPerson: people.sort((a, b) => b.amount - a.amount),
    };
  }

  async list(userId: string, query: QueryCashflowDto = {}) {
    const limit = query.limit ?? 50;
    const offset = query.offset ?? 0;

    const [rows, totals] = await Promise.all([
      this.prisma.$queryRaw<MovementRow[]>`
        ${this.movements(userId)}
        SELECT * FROM movements ${this.window(query)}
        ORDER BY at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `,
      this.prisma.$queryRaw<
        { total: bigint; out: Prisma.Decimal | null; inbound: Prisma.Decimal | null }[]
      >`
        ${this.movements(userId)}
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(amount) FILTER (WHERE direction = 'OUT'), 0) AS out,
          COALESCE(SUM(amount) FILTER (WHERE direction = 'IN'), 0) AS inbound
        FROM movements ${this.window(query)}
      `,
    ]);

    const out = toNumber(totals[0]?.out ?? new Prisma.Decimal(0));
    const inbound = toNumber(totals[0]?.inbound ?? new Prisma.Decimal(0));

    return {
      total: Number(totals[0]?.total ?? 0),
      limit,
      offset,
      // Computed here because the balance and the forecast both read it, and
      // two of them working it out separately will eventually disagree.
      totals: { out, in: inbound, net: Number((inbound - out).toFixed(2)) },
      items: rows.map((row) => this.present(row)),
    };
  }

  private present(row: MovementRow) {
    const counterparty =
      row.counterpartyId !== null
        ? { id: row.counterpartyId, name: row.counterpartyName }
        : null;

    return {
      id: row.id,
      kind: row.kind,
      at: row.at,
      direction: row.direction,
      amount: toNumber(row.amount),
      // A settlement's note where there is one; "₹1,000" beside nobody is
      // unreadable a month later.
      title: row.title?.trim() || this.settlementTitle(row),
      category: row.category,
      groupId: row.groupId,
      groupName: row.groupName,
      // Travels with a group expense so one response renders both views:
      // "3,600 left your account, 900 of it was yours".
      myShare: row.myShare !== null ? toNumber(row.myShare) : null,
      counterparty,
    };
  }

  private settlementTitle(row: MovementRow): string {
    const name = row.counterpartyName ?? 'someone';

    if (row.kind === 'SETTLEMENT_RECEIVED') {
      return `${name} paid you`;
    }

    if (row.kind === 'SETTLEMENT_PAID') {
      return `Paid ${name}`;
    }

    return 'Expense';
  }

  /**
   * The four movements, merged in SQL. A client cannot do this: settlements and
   * group expenses are listable only one group at a time, so it would need a
   * request per group and still could not page a merged list correctly.
   */
  private movements(userId: string): Prisma.Sql {
    return Prisma.sql`
      WITH movements AS (
        SELECT
          e.id,
          'PERSONAL_EXPENSE' AS kind,
          e.date AS at,
          'OUT' AS direction,
          e."totalAmount" AS amount,
          e.title,
          e.category,
          NULL::text AS "groupId",
          NULL::text AS "groupName",
          NULL::numeric AS "myShare",
          NULL::text AS "counterpartyId",
          NULL::text AS "counterpartyName"
        FROM "Expense" e
        WHERE e.scope = 'PERSONAL' AND e."ownerId" = ${userId}

        UNION ALL

        -- Only expenses this user actually paid. A group expense somebody else
        -- paid moves none of their money; it appears when they settle.
        SELECT
          e.id,
          'GROUP_EXPENSE_PAID',
          e.date,
          'OUT',
          e."totalAmount",
          e.title,
          e.category,
          e."groupId",
          g.name,
          COALESCE(s.amount, 0),
          NULL,
          NULL
        FROM "Expense" e
        JOIN "Group" g ON g.id = e."groupId"
        -- LEFT, because fronting a bill you are not part of still moves the
        -- full amount out of your account.
        LEFT JOIN "ExpenseShare" s ON s."expenseId" = e.id AND s."userId" = ${userId}
        WHERE e.scope = 'GROUP' AND e."paidById" = ${userId}

        UNION ALL

        SELECT
          st.id,
          'SETTLEMENT_PAID',
          st."settledAt",
          'OUT',
          st.amount,
          st.note,
          NULL,
          st."groupId",
          g.name,
          NULL,
          u.id,
          u.name
        FROM "Settlement" st
        JOIN "Group" g ON g.id = st."groupId"
        JOIN "User" u ON u.id = st."toUserId"
        WHERE st."fromUserId" = ${userId}

        UNION ALL

        SELECT
          st.id,
          'SETTLEMENT_RECEIVED',
          st."settledAt",
          'IN',
          st.amount,
          st.note,
          NULL,
          st."groupId",
          g.name,
          NULL,
          u.id,
          u.name
        FROM "Settlement" st
        JOIN "Group" g ON g.id = st."groupId"
        JOIN "User" u ON u.id = st."fromUserId"
        WHERE st."toUserId" = ${userId}
      )
    `;
  }

  /**
   * The same predicate for the page and for the totals - if they could drift
   * apart, a total would describe a different set of rows than the list under
   * it.
   */
  private window(query: QueryCashflowDto): Prisma.Sql {
    const clauses: Prisma.Sql[] = [];

    if (query.from) {
      clauses.push(Prisma.sql`at >= ${new Date(query.from)}`);
    }

    if (query.to) {
      clauses.push(Prisma.sql`at <= ${new Date(query.to)}`);
    }

    return clauses.length === 0
      ? Prisma.empty
      : Prisma.sql`WHERE ${Prisma.join(clauses, ' AND ')}`;
  }
}
