import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePersonDto } from './dto/create-person.dto';

@Injectable()
export class PeopleService {
  constructor(private prisma: PrismaService) {}

  async create(userId: string, dto: CreatePersonDto) {
    return this.prisma.person.create({
      data: {
        userId,
        name: dto.name,
        nickname: dto.nickname,
        phone: dto.phone,
        email: dto.email,
      },
    });
  }

  async findOrCreateByName(userId: string, name: string) {
    const existing = await this.prisma.person.findFirst({
      where: {
        userId,
        name: {
          equals: name.trim(),
        },
      },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.person.create({
      data: {
        userId,
        name: name.trim(),
      },
    });
  }

  async findAllWithBalances(userId: string) {
    const people = await this.prisma.person.findMany({
      where: { userId },
      include: {
        participants: {
          include: {
            expense: true,
          },
        },
      },
    });

    return people.map((person) => {
      let youOwePerson = 0;
      let personOwesYou = 0;

      person.participants.forEach((part) => {
        if (part.status === 'PENDING') {
          const expense = part.expense;
          // If expense type is IOU_PAYABLE or user paid split, calculate direction
          if (expense.type === 'IOU_PAYABLE') {
            youOwePerson += part.shareAmount;
          } else if (expense.type === 'IOU_RECEIVABLE' || expense.type === 'SPLIT_EXPENSE') {
            personOwesYou += part.shareAmount;
          }
        }
      });

      return {
        id: person.id,
        name: person.name,
        nickname: person.nickname,
        phone: person.phone,
        email: person.email,
        youOwePerson,
        personOwesYou,
        netBalance: personOwesYou - youOwePerson,
      };
    });
  }

  async getHistory(userId: string, personId: string) {
    const person = await this.prisma.person.findFirst({
      where: { id: personId, userId },
    });

    if (!person) {
      throw new NotFoundException(`Person with ID ${personId} not found`);
    }

    const participants = await this.prisma.expenseParticipant.findMany({
      where: { personId },
      include: {
        expense: true,
      },
      orderBy: { expense: { createdAt: 'desc' } },
    });

    return {
      person,
      transactions: participants.map((p) => ({
        id: p.expense.id,
        title: p.expense.title,
        totalAmount: p.expense.totalAmount,
        shareAmount: p.shareAmount,
        type: p.expense.type,
        status: p.status,
        createdAt: p.expense.createdAt,
      })),
    };
  }
}
