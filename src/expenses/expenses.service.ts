import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PeopleService } from '../people/people.service';
import { CreateIOUDto, IOUDirection } from './dto/create-iou.dto';
import { SplitExpenseDto } from './dto/split-expense.dto';
import { AddNamesDto } from './dto/add-names.dto';

@Injectable()
export class ExpensesService {
  constructor(
    private prisma: PrismaService,
    private peopleService: PeopleService,
  ) {}

  async createIOU(userId: string, dto: CreateIOUDto) {
    const person = await this.peopleService.findOrCreateByName(userId, dto.personName);

    const type = dto.direction === IOUDirection.PAYABLE ? 'IOU_PAYABLE' : 'IOU_RECEIVABLE';
    const title = dto.reason ? `${dto.reason} (${dto.personName})` : `IOU - ${dto.personName}`;

    const expense = await this.prisma.expense.create({
      data: {
        userId,
        title,
        totalAmount: dto.amount,
        type,
        status: 'PENDING',
        participantsCount: 2,
        unnamedParticipantsCount: 0,
        participants: {
          create: [
            {
              isMe: true,
              shareAmount: dto.amount,
              status: dto.direction === IOUDirection.PAYABLE ? 'PENDING' : 'PAID',
            },
            {
              personId: person.id,
              isMe: false,
              shareAmount: dto.amount,
              status: dto.direction === IOUDirection.RECEIVABLE ? 'PENDING' : 'PAID',
            },
          ],
        },
      },
      include: {
        participants: {
          include: { person: true },
        },
      },
    });

    return expense;
  }

  async splitExpense(userId: string, dto: SplitExpenseDto) {
    const count = dto.participantsCount;
    const sharePerPerson = Number((dto.totalAmount / count).toFixed(2));
    const names = dto.names || [];

    const unnamedCount = Math.max(0, count - 1 - names.length);

    const participantData: any[] = [
      {
        isMe: true,
        shareAmount: sharePerPerson,
        status: 'PAID',
      },
    ];

    for (const name of names) {
      const person = await this.peopleService.findOrCreateByName(userId, name);
      participantData.push({
        personId: person.id,
        isMe: false,
        shareAmount: sharePerPerson,
        status: 'PENDING',
      });
    }

    for (let i = 0; i < unnamedCount; i++) {
      participantData.push({
        personId: null,
        isMe: false,
        shareAmount: sharePerPerson,
        status: 'PENDING',
      });
    }

    const expense = await this.prisma.expense.create({
      data: {
        userId,
        title: dto.title,
        totalAmount: dto.totalAmount,
        type: 'SPLIT_EXPENSE',
        status: 'PENDING',
        participantsCount: count,
        unnamedParticipantsCount: unnamedCount,
        participants: {
          create: participantData,
        },
      },
      include: {
        participants: {
          include: { person: true },
        },
      },
    });

    return {
      ...expense,
      myShare: sharePerPerson,
      othersOweTotal: Number((dto.totalAmount - sharePerPerson).toFixed(2)),
    };
  }

  async addNamesToExpense(userId: string, expenseId: string, dto: AddNamesDto) {
    const expense = await this.prisma.expense.findFirst({
      where: { id: expenseId, userId },
      include: { participants: true },
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${expenseId} not found`);
    }

    const unnamedParticipants = expense.participants.filter((p) => !p.isMe && !p.personId);

    if (unnamedParticipants.length === 0) {
      throw new BadRequestException('No unnamed participants exist for this expense.');
    }

    const namesToAdd = dto.names.slice(0, unnamedParticipants.length);

    for (let i = 0; i < namesToAdd.length; i++) {
      const name = namesToAdd[i];
      const participant = unnamedParticipants[i];
      const person = await this.peopleService.findOrCreateByName(userId, name);

      await this.prisma.expenseParticipant.update({
        where: { id: participant.id },
        data: { personId: person.id },
      });
    }

    const updatedUnnamedCount = Math.max(0, expense.unnamedParticipantsCount - namesToAdd.length);

    await this.prisma.expense.update({
      where: { id: expenseId },
      data: { unnamedParticipantsCount: updatedUnnamedCount },
    });

    return this.findOne(userId, expenseId);
  }

  async settleParticipant(userId: string, participantId: string) {
    const participant = await this.prisma.expenseParticipant.findUnique({
      where: { id: participantId },
      include: { expense: true },
    });

    if (!participant || participant.expense.userId !== userId) {
      throw new NotFoundException(`Participant record ${participantId} not found`);
    }

    await this.prisma.expenseParticipant.update({
      where: { id: participantId },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const remainingPending = await this.prisma.expenseParticipant.count({
      where: {
        expenseId: participant.expenseId,
        status: 'PENDING',
      },
    });

    if (remainingPending === 0) {
      await this.prisma.expense.update({
        where: { id: participant.expenseId },
        data: { status: 'SETTLED' },
      });
    }

    return this.findOne(userId, participant.expenseId);
  }

  async findAll(userId: string) {
    return this.prisma.expense.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      include: {
        participants: {
          include: { person: true },
        },
      },
    });
  }

  async findOne(userId: string, id: string) {
    const expense = await this.prisma.expense.findFirst({
      where: { id, userId },
      include: {
        participants: {
          include: { person: true },
        },
      },
    });

    if (!expense) {
      throw new NotFoundException(`Expense with ID ${id} not found`);
    }

    return expense;
  }
}
