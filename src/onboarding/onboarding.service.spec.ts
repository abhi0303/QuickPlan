import { Test, TestingModule } from '@nestjs/testing';
import { OnboardingService } from './onboarding.service';
import { PrismaService } from '../prisma/prisma.service';
import { TOTAL_STEPS, TOUR_STEPS, TOUR_VERSION } from './tour.config';

describe('OnboardingService', () => {
  let service: OnboardingService;

  const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };

  const row = (over: Partial<Record<string, unknown>> = {}) => ({
    onboardingVersion: 0,
    onboardingStep: 0,
    onboardingCompletedAt: null,
    ...over,
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.user.update.mockImplementation(({ data }) => Promise.resolve(row(data)));

    const module: TestingModule = await Test.createTestingModule({
      providers: [OnboardingService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(OnboardingService);
  });

  describe('tour definition', () => {
    it('covers the areas in the order the product introduces them', () => {
      expect(TOUR_STEPS.map((s) => s.id)).toEqual([
        'welcome', 'tasks', 'reminders', 'money', 'level', 'missions', 'finish',
      ]);
    });

    it('numbers steps contiguously from 1', () => {
      expect(TOUR_STEPS.map((s) => s.order)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(TOTAL_STEPS).toBe(TOUR_STEPS.length);
    });

    it('gives every step a route and a unique id', () => {
      expect(TOUR_STEPS.every((s) => s.route.startsWith('/'))).toBe(true);
      expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(TOTAL_STEPS);
    });
  });

  describe('who sees it', () => {
    it('shows the tour to a brand new user', async () => {
      prisma.user.findUnique.mockResolvedValue(row());

      const tour = await service.getTour('u1');

      expect(tour.shouldShow).toBe(true);
      expect(tour.currentStep).toBe(0);
      expect(tour.steps).toHaveLength(TOTAL_STEPS);
    });

    it('does not show it again once finished', async () => {
      prisma.user.findUnique.mockResolvedValue(
        row({ onboardingVersion: TOUR_VERSION, onboardingStep: TOTAL_STEPS }),
      );

      expect((await service.getTour('u1')).shouldShow).toBe(false);
    });

    it('shows it again when the tour version moves ahead of theirs', async () => {
      // Someone who finished version 1 sees version 2 without a per-user reset.
      prisma.user.findUnique.mockResolvedValue(row({ onboardingVersion: TOUR_VERSION - 1 }));

      expect((await service.getTour('u1')).shouldShow).toBe(true);
    });

    it('treats a missing user as never having seen it', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      expect((await service.getTour('u1')).shouldShow).toBe(true);
    });
  });

  describe('resuming', () => {
    it('picks up where the user stopped', async () => {
      prisma.user.findUnique.mockResolvedValue(row({ onboardingStep: 3 }));

      expect((await service.getTour('u1')).currentStep).toBe(3);
    });

    it('never rewinds progress when a late request arrives out of order', async () => {
      prisma.user.findUnique.mockResolvedValue(row({ onboardingStep: 5 }));

      await service.saveProgress('u1', 2);

      expect(prisma.user.update.mock.calls[0][0].data.onboardingStep).toBe(5);
    });

    it('advances progress when the step is ahead', async () => {
      prisma.user.findUnique.mockResolvedValue(row({ onboardingStep: 2 }));

      await service.saveProgress('u1', 4);

      expect(prisma.user.update.mock.calls[0][0].data.onboardingStep).toBe(4);
    });

    it('clamps a resume point left over from a longer tour', async () => {
      prisma.user.findUnique.mockResolvedValue(row({ onboardingStep: 99 }));

      expect((await service.getTour('u1')).currentStep).toBe(TOTAL_STEPS);
    });
  });

  describe('finishing', () => {
    it('stamps the version and the completion time', async () => {
      prisma.user.findUnique.mockResolvedValue(row());

      await service.complete('u1');

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data.onboardingVersion).toBe(TOUR_VERSION);
      expect(data.onboardingStep).toBe(TOTAL_STEPS);
      expect(data.onboardingCompletedAt).toEqual(expect.any(Date));
    });

    it('keeps the original timestamp when completed twice', async () => {
      const first = new Date('2026-08-01T00:00:00Z');
      prisma.user.findUnique.mockResolvedValue(
        row({ onboardingVersion: TOUR_VERSION, onboardingCompletedAt: first }),
      );

      await service.complete('u1');

      expect(prisma.user.update.mock.calls[0][0].data.onboardingCompletedAt).toBe(first);
    });

    it('treats skipping as finishing, so it does not reappear next login', async () => {
      prisma.user.findUnique.mockResolvedValue(row());

      await service.skip('u1');

      expect(prisma.user.update.mock.calls[0][0].data.onboardingVersion).toBe(TOUR_VERSION);
    });
  });

  describe('restart from Settings', () => {
    it('clears the flag and hands back the steps ready to play', async () => {
      const result = await service.restart('u1');

      const data = prisma.user.update.mock.calls[0][0].data;
      expect(data).toEqual({
        onboardingVersion: 0,
        onboardingStep: 0,
        onboardingCompletedAt: null,
      });
      expect(result.shouldShow).toBe(true);
      expect(result.currentStep).toBe(0);
      expect(result.steps).toHaveLength(TOTAL_STEPS);
    });
  });
});
