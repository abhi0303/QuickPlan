import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { toNumber } from '../common/money';
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
  constructor(private readonly prisma: PrismaService) {}

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
