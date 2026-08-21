import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { toNumber } from '../common/money';

@Injectable()
export class PeopleService {
  constructor(private prisma: PrismaService) {}

  static nameKey(name: string): string {
    return name.trim().toLowerCase();
  }

  async create(userId: string, dto: CreatePersonDto) {
    return this.prisma.person.create({
      data: {
        userId,
        name: dto.name.trim(),
        nameKey: PeopleService.nameKey(dto.name),
        nickname: dto.nickname,
        phone: dto.phone,
        email: dto.email,
      },
    });
  }

  /**
   * Matches on a case-folded key so "Rahul" and "rahul" resolve to one contact.
   * The upsert leans on the @@unique([userId, nameKey]) constraint, so two
   * concurrent requests cannot create duplicates.
   */
  async findOrCreateByName(userId: string, name: string) {
    const nameKey = PeopleService.nameKey(name);

    return this.prisma.person.upsert({
      where: { userId_nameKey: { userId, nameKey } },
      update: {},
      create: { userId, name: name.trim(), nameKey },
    });
  }

  /**
   * Balances follow one rule, applied to every expense type:
   *
   *   - they owe me   -> I fronted the money (paidByMe), and their share is unpaid
   *   - I owe them    -> they fronted the money (paidById), and my share is unpaid
   *
   * Reading direction off who actually paid is what makes both sides work.
   * The previous version keyed off the contact's own row status, so payables
   * were never counted and "you owe" was permanently zero.
   */
  async findAllWithBalances(userId: string) {
    const people = await this.prisma.person.findMany({
      where: { userId },
      orderBy: { name: 'asc' },
      include: {
        participants: {
          where: { status: 'PENDING' },
          include: { expense: { select: { paidByMe: true } } },
        },
        paidExpenses: {
          where: { paidByMe: false },
          include: {
            participants: { where: { isMe: true, status: 'PENDING' } },
          },
        },
      },
    });

    return people.map((person) => {
      const personOwesYou = person.participants
        .filter((part) => part.expense.paidByMe)
        .reduce((sum, part) => sum.add(part.shareAmount), new Prisma.Decimal(0));

      const youOwePerson = person.paidExpenses
        .flatMap((expense) => expense.participants)
        .reduce((sum, part) => sum.add(part.shareAmount), new Prisma.Decimal(0));

      return {
        id: person.id,
        name: person.name,
        nickname: person.nickname,
        phone: person.phone,
        email: person.email,
        youOwePerson: toNumber(youOwePerson),
        personOwesYou: toNumber(personOwesYou),
        netBalance: toNumber(personOwesYou.sub(youOwePerson)),
      };
    });
  }

  /**
   * A contact's history spans both directions: rows where they owe a share,
   * and expenses they paid where the outstanding share is mine. Reading only
   * the first would hide every payable, since an IOU I owe has no participant
   * row for the other party.
   */
  async getHistory(userId: string, personId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, userId },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID ${personId} not found`);
    }

    const [theirShares, expensesTheyPaid] = await Promise.all([
      this.prisma.expenseParticipant.findMany({
        where: { personId, expense: { userId } },
        include: { expense: true },
      }),
      this.prisma.expense.findMany({
        where: { userId, paidById: personId },
        include: { participants: { where: { isMe: true } } },
      }),
    ]);

    const transactions = [
      ...theirShares.map((part) => ({
        id: part.expense.id,
        participantId: part.id,
        title: part.expense.title,
        totalAmount: toNumber(part.expense.totalAmount),
        shareAmount: toNumber(part.shareAmount),
        type: part.expense.type,
        direction: part.expense.paidByMe ? 'OWED_TO_ME' : 'I_OWE',
        status: part.status,
        createdAt: part.expense.createdAt,
      })),
      ...expensesTheyPaid.flatMap((expense) =>
        expense.participants.map((part) => ({
          id: expense.id,
          participantId: part.id,
          title: expense.title,
          totalAmount: toNumber(expense.totalAmount),
          shareAmount: toNumber(part.shareAmount),
          type: expense.type,
          direction: 'I_OWE' as const,
          status: part.status,
          createdAt: expense.createdAt,
        })),
      ),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    return { person, transactions };
  }
}
