import { Injectable, Logger } from '@nestjs/common';
import { MissionStatus, MissionType, NotificationType, Prisma, UserMission } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MissionProgressService } from './mission-progress.service';
import { NotificationEmitter } from '../notifications/notification-emitter.service';
import { ActivityKind } from './gamification.events';
import {
  CYCLE_DURATION_DAYS,
  MISSIONS_PER_CYCLE,
  MISSION_CATALOGUE,
  MISSION_XP,
  MissionDefinition,
  catalogue,
} from './mission.catalogue';
import { LevelState, levelState, MAX_LEVEL, rankName } from './level.config';

export interface LevelUpResult {
  xpEarned: number;
  previousLevel: number;
  newLevel: number;
  levelUp: boolean;
  rankName: string;
}

@Injectable()
export class GamificationService {
  private readonly logger = new Logger(GamificationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly progress: MissionProgressService,
    private readonly emitter: NotificationEmitter,
  ) {}

  // ------------------------------------------------------------------
  // Read
  // ------------------------------------------------------------------

  /**
   * The one endpoint the frontend needs. Also the lazy cleanup point: an
   * expired cycle is retired and replaced here, so a user who never triggers
   * the nightly job still gets fresh missions the moment they look.
   */
  async getState(userId: string) {
    await this.ensureCurrentCycle(userId);

    const [user, missions] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: userId },
        select: { totalXp: true, currentLevel: true },
      }),
      this.prisma.userMission.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
      }),
    ]);

    const totalXp = user?.totalXp ?? 0;
    const state = levelState(totalXp);

    return {
      totalXp,
      ...this.presentLevel(state),
      missions: missions.map((mission) => this.presentMission(mission)),
    };
  }

  private presentLevel(state: LevelState) {
    return {
      level: state.level,
      rankName: state.rankName,
      currentLevelXp: state.currentLevelXp,
      nextLevelXp: state.nextLevelXp,
      xpIntoLevel: state.xpIntoLevel,
      xpForNextLevel: state.xpForNextLevel,
      progressPercentage: state.progressPercentage,
    };
  }

  private presentMission(mission: UserMission) {
    return {
      id: mission.id,
      type: mission.type,
      target: mission.target,
      progress: mission.progress,
      status: mission.status,
      xp: MISSION_XP,
      createdAt: mission.createdAt,
      expiresAt: mission.expiresAt,
    };
  }

  /** Static definitions, so the frontend can cache titles and icons. */
  getCatalogue() {
    return {
      xpPerMission: MISSION_XP,
      missionsPerCycle: MISSIONS_PER_CYCLE,
      cycleDurationDays: CYCLE_DURATION_DAYS,
      missions: catalogue(),
    };
  }

  // ------------------------------------------------------------------
  // Cycle management
  // ------------------------------------------------------------------

  /**
   * A cycle is replaced only once every mission in it is finished - expired or
   * completed. Missions that are still active are left alone even if the user
   * has just finished two of the three.
   */
  async ensureCurrentCycle(userId: string, now = new Date()): Promise<void> {
    const missions = await this.prisma.userMission.findMany({ where: { userId } });

    if (missions.length === 0) {
      await this.generateCycle(userId, now);
      return;
    }

    const stale = missions.filter(
      (mission) => mission.status === MissionStatus.ACTIVE && mission.expiresAt <= now,
    );

    if (stale.length > 0) {
      await this.prisma.userMission.updateMany({
        where: { id: { in: stale.map((m) => m.id) } },
        data: { status: MissionStatus.EXPIRED },
      });
    }

    const anyActive = missions.some(
      (mission) => mission.status === MissionStatus.ACTIVE && mission.expiresAt > now,
    );

    if (!anyActive) {
      // Nothing left to play - drop the whole set and deal a new one. Expired
      // and completed rows are deleted rather than archived, which is what
      // keeps this table at three rows per user.
      await this.prisma.userMission.deleteMany({ where: { userId } });
      await this.generateCycle(userId, now);
    }
  }

  /**
   * Picks three missions server-side, one per activity area where possible so a
   * cycle is not three variations of the same thing, and never two of the same
   * type.
   */
  async generateCycle(userId: string, now = new Date()): Promise<void> {
    const expiresAt = new Date(now.getTime() + CYCLE_DURATION_DAYS * 24 * 60 * 60 * 1000);
    const chosen = this.selectMissions();

    try {
      await this.prisma.userMission.createMany({
        data: chosen.map((definition) => ({
          userId,
          type: definition.type,
          target: definition.target,
          progress: 0,
          status: MissionStatus.ACTIVE,
          expiresAt,
        })),
        // Two requests racing to deal a cycle must not produce six rows; the
        // unique (userId, type) constraint makes the loser a no-op.
        skipDuplicates: true,
      });
    } catch (error) {
      this.logger.error(
        `Could not generate missions for ${userId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private selectMissions(): MissionDefinition[] {
    const byArea = new Map<string, MissionDefinition[]>();

    for (const definition of MISSION_CATALOGUE) {
      const bucket = byArea.get(definition.area) ?? [];
      bucket.push(definition);
      byArea.set(definition.area, bucket);
    }

    const chosen: MissionDefinition[] = [];
    const usedTypes = new Set<MissionType>();

    // One from each area first, so a cycle spans the product.
    for (const area of this.shuffle([...byArea.keys()])) {
      const options = byArea.get(area) ?? [];
      const pick = this.shuffle(options).find((d) => !usedTypes.has(d.type));

      if (pick && chosen.length < MISSIONS_PER_CYCLE) {
        chosen.push(pick);
        usedTypes.add(pick.type);
      }
    }

    // Top up from anywhere if an area could not supply one.
    for (const definition of this.shuffle([...MISSION_CATALOGUE])) {
      if (chosen.length >= MISSIONS_PER_CYCLE) {
        break;
      }

      if (!usedTypes.has(definition.type)) {
        chosen.push(definition);
        usedTypes.add(definition.type);
      }
    }

    return chosen;
  }

  private shuffle<T>(items: T[]): T[] {
    const copy = [...items];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return copy;
  }

  // ------------------------------------------------------------------
  // Progress
  // ------------------------------------------------------------------

  /**
   * Re-measures every active mission the activity could affect. One event can
   * move several missions - adding an expense can advance a count, a category
   * spread and a day streak at once.
   */
  async handleActivity(kind: ActivityKind, userId: string): Promise<void> {
    const types = MissionProgressService.typesFor(kind);

    if (types.length === 0) {
      return;
    }

    try {
      const now = new Date();
      const missions = await this.prisma.userMission.findMany({
        where: {
          userId,
          type: { in: types },
          status: MissionStatus.ACTIVE,
          expiresAt: { gt: now },
        },
      });

      for (const mission of missions) {
        const measured = await this.progress.measure(userId, mission.type, mission.createdAt);
        const progress = Math.min(measured, mission.target);

        if (progress >= mission.target) {
          await this.completeMission(mission, progress);
        } else if (progress !== mission.progress) {
          await this.prisma.userMission.update({
            where: { id: mission.id },
            data: { progress },
          });
        }
      }
    } catch (error) {
      // Gamification must never break the action that triggered it.
      this.logger.error(
        `Mission progress for ${userId} after ${kind} failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * The conditional update is the duplicate-XP guard: only a row still ACTIVE
   * and unexpired flips to COMPLETED, and only the request that flipped it goes
   * on to award XP. A retry finds count 0 and awards nothing.
   */
  private async completeMission(mission: UserMission, progress: number): Promise<void> {
    const { count } = await this.prisma.userMission.updateMany({
      where: {
        id: mission.id,
        status: MissionStatus.ACTIVE,
        expiresAt: { gt: new Date() },
      },
      data: { status: MissionStatus.COMPLETED, progress },
    });

    if (count === 0) {
      return;
    }

    const result = await this.awardXp(mission.userId, MISSION_XP);
    await this.announce(mission, result);
  }

  /**
   * Increment and re-derive in one statement so two completions landing at the
   * same moment cannot read the same starting total and lose one award.
   */
  private async awardXp(userId: string, amount: number): Promise<LevelUpResult> {
    const before = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { currentLevel: true },
    });

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { totalXp: { increment: amount } },
      select: { totalXp: true },
    });

    const state = levelState(updated.totalXp);

    await this.prisma.user.update({
      where: { id: userId },
      data: { currentLevel: state.level },
    });

    const previousLevel = before?.currentLevel ?? 1;

    return {
      xpEarned: amount,
      previousLevel,
      // Enough XP for several levels at once still resolves in one step.
      newLevel: state.level,
      levelUp: state.level > previousLevel,
      rankName: rankName(state.level),
    };
  }

  private async announce(mission: UserMission, result: LevelUpResult): Promise<void> {
    const definition = MISSION_CATALOGUE.find(
      (d) => d.type === mission.type && d.target === mission.target,
    );

    await this.emitter.emit([
      {
        userId: mission.userId,
        type: NotificationType.MISSION_COMPLETED,
        title: 'Mission complete',
        body: `${definition?.description ?? 'Mission complete'} — +${result.xpEarned} XP`,
        url: '/gamification',
        entityId: mission.id,
        data: { missionType: mission.type, xpEarned: result.xpEarned },
        tag: `mission-${mission.id}`,
        requireInteraction: false,
      },
      ...(result.levelUp
        ? [
            {
              userId: mission.userId,
              type: NotificationType.LEVEL_UP,
              title: `Level ${result.newLevel}`,
              body: `You reached ${result.rankName}.`,
              url: '/gamification',
              // Everything §29 asks for, so the frontend can play the level-up
              // animation straight from the push.
              data: {
                xpEarned: result.xpEarned,
                previousLevel: result.previousLevel,
                newLevel: result.newLevel,
                levelUp: true,
                rankName: result.rankName,
              },
              tag: `level-${result.newLevel}`,
              requireInteraction: false,
            },
          ]
        : []),
    ]);
  }

  // ------------------------------------------------------------------
  // Housekeeping
  // ------------------------------------------------------------------

  /** Retires finished cycles for users who have not opened the app. */
  async sweepExpiredCycles(now = new Date()): Promise<number> {
    const stale = await this.prisma.userMission.findMany({
      where: { status: MissionStatus.ACTIVE, expiresAt: { lte: now } },
      select: { userId: true },
      distinct: ['userId'],
    });

    for (const { userId } of stale) {
      await this.ensureCurrentCycle(userId, now);
    }

    return stale.length;
  }

  /** Exposed for tests and for the level bar at the cap. */
  get maxLevel(): number {
    return MAX_LEVEL;
  }
}
