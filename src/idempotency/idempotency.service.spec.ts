import { Test, TestingModule } from '@nestjs/testing';
import { IdempotencyService, RETENTION_HOURS } from './idempotency.service';
import { PrismaService } from '../prisma/prisma.service';

describe('IdempotencyService', () => {
  let service: IdempotencyService;

  const prisma = {
    idempotencyKey: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn().mockResolvedValue({}),
      delete: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };

  const conflict = Object.assign(new Error('unique'), { code: 'P2002' });

  beforeEach(async () => {
    jest.clearAllMocks();
    prisma.idempotencyKey.create.mockResolvedValue({});

    const module: TestingModule = await Test.createTestingModule({
      providers: [IdempotencyService, { provide: PrismaService, useValue: prisma }],
    }).compile();
    service = module.get(IdempotencyService);
  });

  describe('hashBody', () => {
    it('ignores key ordering, so the same payload hashes the same', () => {
      expect(service.hashBody({ a: 1, b: 2 })).toBe(service.hashBody({ b: 2, a: 1 }));
    });

    it('distinguishes genuinely different bodies', () => {
      expect(service.hashBody({ title: 'milk' })).not.toBe(service.hashBody({ title: 'bread' }));
    });

    it('handles nested objects and arrays', () => {
      expect(service.hashBody({ a: [{ x: 1, y: 2 }] })).toBe(service.hashBody({ a: [{ y: 2, x: 1 }] }));
    });

    it('treats an absent body as null rather than throwing', () => {
      expect(() => service.hashBody(undefined)).not.toThrow();
    });
  });

  describe('claim', () => {
    it('lets the first request through', async () => {
      expect(await service.claim('u1', 'k1', 'h1')).toEqual({ outcome: 'FRESH' });
    });

    it('replays a completed request', async () => {
      prisma.idempotencyKey.create.mockRejectedValue(conflict);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        requestHash: 'h1',
        status: 201,
        response: { id: 'task-1' },
      });

      expect(await service.claim('u1', 'k1', 'h1')).toEqual({
        outcome: 'REPLAY',
        stored: { status: 201, body: { id: 'task-1' } },
      });
    });

    it('rejects a key reused with a different body', async () => {
      prisma.idempotencyKey.create.mockRejectedValue(conflict);
      prisma.idempotencyKey.findUnique.mockResolvedValue({
        requestHash: 'DIFFERENT',
        status: 201,
        response: {},
      });

      expect(await service.claim('u1', 'k1', 'h1')).toEqual({ outcome: 'MISMATCH' });
    });

    it('reports a request still in flight', async () => {
      prisma.idempotencyKey.create.mockRejectedValue(conflict);
      prisma.idempotencyKey.findUnique.mockResolvedValue({ requestHash: 'h1', status: null });

      expect(await service.claim('u1', 'k1', 'h1')).toEqual({ outcome: 'IN_FLIGHT' });
    });

    it('lets the request run if the key was swept mid-race', async () => {
      prisma.idempotencyKey.create.mockRejectedValue(conflict);
      prisma.idempotencyKey.findUnique.mockResolvedValue(null);

      expect(await service.claim('u1', 'k1', 'h1')).toEqual({ outcome: 'FRESH' });
    });

    it('does not swallow an unrelated database error', async () => {
      prisma.idempotencyKey.create.mockRejectedValue(new Error('connection lost'));

      await expect(service.claim('u1', 'k1', 'h1')).rejects.toThrow('connection lost');
    });
  });

  describe('record', () => {
    it('stores a successful response', async () => {
      await service.record('u1', 'k1', 201, { id: 'task-1' });

      expect(prisma.idempotencyKey.update).toHaveBeenCalledWith({
        where: { userId_key: { userId: 'u1', key: 'k1' } },
        data: { status: 201, response: { id: 'task-1' } },
      });
    });

    /** Caching a 5xx would turn a transient failure into a permanent one. */
    it.each([400, 404, 422, 500, 503])('releases the key on %i instead of caching it', async (status) => {
      await service.record('u1', 'k1', status, { message: 'nope' });

      expect(prisma.idempotencyKey.update).not.toHaveBeenCalled();
      expect(prisma.idempotencyKey.delete).toHaveBeenCalled();
    });
  });

  describe('purgeExpired', () => {
    it('sweeps keys older than the retention window', async () => {
      const now = new Date('2026-08-25T12:00:00Z');

      await service.purgeExpired(now);

      const cutoff = prisma.idempotencyKey.deleteMany.mock.calls[0][0].where.createdAt.lt;
      expect(cutoff.toISOString()).toBe('2026-08-24T12:00:00.000Z');
      expect(RETENTION_HOURS).toBe(24);
    });
  });
});
