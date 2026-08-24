import { Test, TestingModule } from '@nestjs/testing';
import { MissionStatus, MissionType } from '@prisma/client';
import { GamificationService } from './gamification.service';
import { MissionProgressService } from './mission-progress.service';
import { PrismaService } from '../prisma/prisma.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import { MISSION_CATALOGUE, MISSIONS_PER_CYCLE } from './mission.catalogue';

describe('GamificationService', () => {
  let service: GamificationService;

  const future = new Date(Date.now() + 60 * 60 * 1000);
  const past = new Date(Date.now() - 60 * 60 * 1000);

  const prisma = {
    userMission: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 3 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue({ totalXp: 0, currentLevel: 1 }),
      update: jest.fn().mockResolvedValue({ totalXp: 100 }),
    },
  };

  const progress = { measure: jest.fn() };
  const emitter = { emit: jest.fn(), emitOne: jest.fn() };

  const mission = (over: Partial<Record<string, unknown>> = {}) => ({
    id: 'm1',
    userId: 'u1',
    type: MissionType.EXPENSE_COUNT,
    target: 5,
    progress: 2,
    status: MissionStatus.ACTIVE,
    createdAt: past,
    expiresAt: future,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.userMission.updateMany.mockResolvedValue({ count: 1 });
    prisma.user.findUnique.mockResolvedValue({ totalXp: 0, currentLevel: 1 });
    prisma.user.update.mockResolvedValue({ totalXp: 100 });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GamificationService,
        { provide: PrismaService, useValue: prisma },
        { provide: MissionProgressService, useValue: progress },
        { provide: NotificationEmitter, useValue: emitter },
      ],
    }).compile();
    service = module.get(GamificationService);
  });

  describe('mission selection', () => {
    it('deals exactly three missions with no repeated type', async () => {
      await service.generateCycle('u1');

      const rows = prisma.userMission.createMany.mock.calls[0][0].data;
      expect(rows).toHaveLength(MISSIONS_PER_CYCLE);
      expect(new Set(rows.map((r: any) => r.type)).size).toBe(MISSIONS_PER_CYCLE);
    });

    it('expires the cycle two days out', async () => {
      const now = new Date('2026-08-24T10:00:00Z');
      await service.generateCycle('u1', now);

      const rows = prisma.userMission.createMany.mock.calls[0][0].data;
      expect(rows[0].expiresAt.toISOString()).toBe('2026-08-26T10:00:00.000Z');
    });

    it('skips duplicates so two racing requests cannot deal six missions', async () => {
      await service.generateCycle('u1');

      expect(prisma.userMission.createMany.mock.calls[0][0].skipDuplicates).toBe(true);
    });

    it('never offers a voice expense mission, since expenses have no voice flow', () => {
      const voiceExpense = MISSION_CATALOGUE.filter(
        (d) => d.area === 'EXPENSE' && d.type.toString().includes('VOICE'),
      );

      expect(voiceExpense).toHaveLength(0);
    });
  });

  describe('cycle lifecycle', () => {
    it('deals a first cycle for a brand new user', async () => {
      prisma.userMission.findMany.mockResolvedValue([]);

      await service.ensureCurrentCycle('u1');

      expect(prisma.userMission.createMany).toHaveBeenCalled();
    });

    it('leaves a cycle alone while any mission is still live', async () => {
      prisma.userMission.findMany.mockResolvedValue([
        mission({ status: MissionStatus.COMPLETED }),
        mission({ id: 'm2' }),
      ]);

      await service.ensureCurrentCycle('u1');

      expect(prisma.userMission.deleteMany).not.toHaveBeenCalled();
      expect(prisma.userMission.createMany).not.toHaveBeenCalled();
    });

    it('marks passed missions expired and replaces the finished set', async () => {
      prisma.userMission.findMany.mockResolvedValue([
        mission({ expiresAt: past }),
        mission({ id: 'm2', expiresAt: past }),
      ]);

      await service.ensureCurrentCycle('u1');

      expect(prisma.userMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { status: MissionStatus.EXPIRED } }),
      );
      // Deleted rather than archived - this is what keeps the table small.
      expect(prisma.userMission.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
      expect(prisma.userMission.createMany).toHaveBeenCalled();
    });
  });

  describe('progress and completion', () => {
    it('measures against the tables rather than trusting an increment', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(3);

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.userMission.update).toHaveBeenCalledWith({
        where: { id: 'm1' },
        data: { progress: 3 },
      });
    });

    it('writes nothing when the measured progress has not moved', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission({ progress: 3 })]);
      progress.measure.mockResolvedValue(3);

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.userMission.update).not.toHaveBeenCalled();
    });

    it('completes and awards 100 XP once the target is reached', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(5);

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.userMission.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'm1', status: MissionStatus.ACTIVE }),
          data: { status: MissionStatus.COMPLETED, progress: 5 },
        }),
      );
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: { totalXp: { increment: 100 } } }),
      );
    });

    it('caps progress at the target when the user overshoots', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(9);

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.userMission.updateMany.mock.calls[0][0].data.progress).toBe(5);
    });

    /** The duplicate-XP guard. */
    it('awards nothing when the conditional completion matches no row', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(5);
      prisma.userMission.updateMany.mockResolvedValue({ count: 0 });

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.user.update).not.toHaveBeenCalled();
      expect(emitter.emit).not.toHaveBeenCalled();
    });

    it('only looks at missions the activity can actually move', async () => {
      prisma.userMission.findMany.mockResolvedValue([]);

      await service.handleActivity('TASK_COMPLETED', 'u1');

      expect(prisma.userMission.findMany.mock.calls[0][0].where.type.in).toEqual([
        MissionType.TASK_COMPLETE_COUNT,
      ]);
    });

    it('advances several missions from one activity', async () => {
      prisma.userMission.findMany.mockResolvedValue([
        mission({ id: 'a', type: MissionType.EXPENSE_COUNT }),
        mission({ id: 'b', type: MissionType.EXPENSE_CATEGORY_COUNT, target: 3 }),
      ]);
      progress.measure.mockResolvedValue(1);

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      expect(prisma.userMission.update).toHaveBeenCalledTimes(2);
    });

    it('swallows an engine failure rather than breaking the user action', async () => {
      prisma.userMission.findMany.mockRejectedValue(new Error('db down'));

      await expect(service.handleActivity('EXPENSE_CREATED', 'u1')).resolves.toBeUndefined();
    });
  });

  describe('level up', () => {
    it('reports a level change and the new rank', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(5);
      prisma.user.findUnique.mockResolvedValue({ totalXp: 0, currentLevel: 1 });
      prisma.user.update.mockResolvedValue({ totalXp: 100 });

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      const events = emitter.emit.mock.calls[0][0];
      const levelUp = events.find((e: any) => e.type === 'LEVEL_UP');
      expect(levelUp.data).toMatchObject({
        previousLevel: 1,
        newLevel: 2,
        levelUp: true,
        xpEarned: 100,
        rankName: 'Coin Keeper',
      });
    });

    it('announces the mission but no level-up when the level is unchanged', async () => {
      prisma.userMission.findMany.mockResolvedValue([mission()]);
      progress.measure.mockResolvedValue(5);
      prisma.user.findUnique.mockResolvedValue({ totalXp: 0, currentLevel: 1 });
      prisma.user.update.mockResolvedValue({ totalXp: 50 });

      await service.handleActivity('EXPENSE_CREATED', 'u1');

      const events = emitter.emit.mock.calls[0][0];
      expect(events.map((e: any) => e.type)).toEqual(['MISSION_COMPLETED']);
    });
  });
});
