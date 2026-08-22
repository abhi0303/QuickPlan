import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { GroupRole } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { GroupAccessService } from '../groups/group-access.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { toDecimal, toNumber } from '../common/money';

const SETTLEMENT_INCLUDE = {
  from: { select: { id: true, name: true, email: true } },
  to: { select: { id: true, name: true, email: true } },
};

@Injectable()
export class SettlementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: GroupAccessService,
  ) {}

  /**
   * Recording a payment rather than flipping a flag: balances stay derived
   * from expenses minus settlements, partial payments work, and the rows
   * double as the payment history the charts read.
   */
  async create(userId: string, groupId: string, dto: CreateSettlementDto) {
    await this.access.requireMembership(userId, groupId);

    const fromUserId = dto.fromUserId ?? userId;

    if (fromUserId === dto.toUserId) {
      throw new BadRequestException('A settlement needs two different members.');
    }

    const members = await this.prisma.groupMember.findMany({
      where: { groupId, userId: { in: [fromUserId, dto.toUserId] } },
      select: { userId: true },
    });

    if (members.length !== 2) {
      throw new BadRequestException('Both people must be members of this group.');
    }

    const settlement = await this.prisma.settlement.create({
      data: {
        groupId,
        fromUserId,
        toUserId: dto.toUserId,
        amount: toDecimal(dto.amount),
        note: dto.note,
        settledAt: dto.settledAt ? new Date(dto.settledAt) : new Date(),
        createdById: userId,
      },
      include: SETTLEMENT_INCLUDE,
    });

    return this.present(settlement);
  }

  async findAll(userId: string, groupId: string) {
    await this.access.requireMembership(userId, groupId);

    const settlements = await this.prisma.settlement.findMany({
      where: { groupId },
      orderBy: { settledAt: 'desc' },
      include: SETTLEMENT_INCLUDE,
    });

    return settlements.map((s) => this.present(s));
  }

  /** Only the person who recorded it, or a group owner, can undo a payment. */
  async remove(userId: string, settlementId: string) {
    const settlement = await this.prisma.settlement.findUnique({ where: { id: settlementId } });

    if (!settlement) {
      throw new NotFoundException(`Settlement ${settlementId} not found`);
    }

    const membership = await this.access.requireMembership(userId, settlement.groupId);

    if (settlement.createdById !== userId && membership.role !== GroupRole.OWNER) {
      throw new ForbiddenException(
        'Only the member who recorded this payment, or a group owner, can delete it.',
      );
    }

    await this.prisma.settlement.delete({ where: { id: settlementId } });

    return { deleted: true, settlementId };
  }

  private present(settlement: {
    amount: unknown;
    from: { name: string | null };
    to: { name: string | null };
  }) {
    return { ...settlement, amount: toNumber(settlement.amount as never) };
  }
}
