import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TOTAL_STEPS, TOUR_STEPS, TOUR_VERSION } from './tour.config';

const TOUR_FIELDS = {
  onboardingVersion: true,
  onboardingStep: true,
  onboardingCompletedAt: true,
} as const;

@Injectable()
export class OnboardingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Everything the client needs to decide whether to open the tour and where to
   * resume it. Steps come from static config, so nothing per-step is stored.
   */
  async getTour(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: TOUR_FIELDS,
    });

    return {
      ...this.summarise(user),
      totalSteps: TOTAL_STEPS,
      steps: TOUR_STEPS.map((step) => ({ ...step })),
    };
  }

  /**
   * The compact form, for embedding in the profile so the client can decide on
   * login without a second request.
   */
  summarise(
    user: { onboardingVersion: number; onboardingStep: number; onboardingCompletedAt: Date | null } | null,
  ) {
    const version = user?.onboardingVersion ?? 0;
    const completedAt = user?.onboardingCompletedAt ?? null;

    // Someone who finished an older tour sees the new one; bumping the version
    // is what re-opens it for everybody.
    const shouldShow = version < TOUR_VERSION;

    return {
      shouldShow,
      version: TOUR_VERSION,
      completedVersion: version,
      completedAt,
      // Resume where they stopped, but never past the end of the current tour.
      currentStep: shouldShow ? Math.min(user?.onboardingStep ?? 0, TOTAL_STEPS) : TOTAL_STEPS,
    };
  }

  /** Progress only moves forward, so a late-arriving request cannot rewind it. */
  async saveProgress(userId: string, step: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: TOUR_FIELDS,
    });

    const next = Math.max(step, user?.onboardingStep ?? 0);

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: { onboardingStep: next },
      select: TOUR_FIELDS,
    });

    return this.summarise(updated);
  }

  /**
   * Idempotent: finishing an already-finished tour keeps the original
   * timestamp rather than moving it.
   */
  async complete(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: TOUR_FIELDS,
    });

    const alreadyDone = (user?.onboardingVersion ?? 0) >= TOUR_VERSION;

    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        onboardingVersion: TOUR_VERSION,
        onboardingStep: TOTAL_STEPS,
        onboardingCompletedAt: alreadyDone ? user?.onboardingCompletedAt : new Date(),
      },
      select: TOUR_FIELDS,
    });

    return this.summarise(updated);
  }

  /**
   * Skipping counts as finishing. The tour has done its job either way, and
   * re-opening it on the next login is exactly the behaviour that annoys
   * people; Settings is there for anyone who wants it back.
   */
  async skip(userId: string) {
    return this.complete(userId);
  }

  /** Settings → Guide. Puts the user back at the start of the current tour. */
  async restart(userId: string) {
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        onboardingVersion: 0,
        onboardingStep: 0,
        onboardingCompletedAt: null,
      },
      select: TOUR_FIELDS,
    });

    return { ...this.summarise(updated), totalSteps: TOTAL_STEPS, steps: TOUR_STEPS.map((s) => ({ ...s })) };
  }
}
