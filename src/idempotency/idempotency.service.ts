import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

export const IDEMPOTENCY_HEADER = 'idempotency-key';
export const RETENTION_HOURS = 24;

export interface StoredResponse {
  status: number;
  body: unknown;
}

export type LookupResult =
  | { outcome: 'FRESH' }
  | { outcome: 'REPLAY'; stored: StoredResponse }
  | { outcome: 'MISMATCH' }
  | { outcome: 'IN_FLIGHT' };

@Injectable()
export class IdempotencyService {
  private readonly logger = new Logger(IdempotencyService.name);

  constructor(private readonly prisma: PrismaService) {}

  hashBody(body: unknown): string {
    // Stable across key ordering, so the same logical payload hashes the same
    // however the client happened to serialise it.
    return createHash('sha256').update(this.stableStringify(body)).digest('hex');
  }

  /**
   * Claims the key for this request. Winning the insert means "you run it";
   * losing means someone already did, or is still doing it.
   */
  async claim(userId: string, key: string, requestHash: string): Promise<LookupResult> {
    try {
      await this.prisma.idempotencyKey.create({
        data: { userId, key, requestHash, status: null },
      });

      return { outcome: 'FRESH' };
    } catch (error) {
      if (!this.isUniqueViolation(error)) {
        throw error;
      }
    }

    const existing = await this.prisma.idempotencyKey.findUnique({
      where: { userId_key: { userId, key } },
    });

    if (!existing) {
      // Swept between the failed insert and this read; let it run again.
      return { outcome: 'FRESH' };
    }

    if (existing.requestHash !== requestHash) {
      return { outcome: 'MISMATCH' };
    }

    if (existing.status === null) {
      // The original is still running. Answering 409 tells the client to back
      // off and try again, by which point the stored response will be there.
      return { outcome: 'IN_FLIGHT' };
    }

    return {
      outcome: 'REPLAY',
      stored: { status: existing.status, body: existing.response },
    };
  }

  /**
   * Only successful responses are stored. Caching a 5xx would turn a transient
   * failure into a permanent one, since every retry would be answered from the
   * cache instead of actually retrying.
   */
  async record(userId: string, key: string, status: number, body: unknown): Promise<void> {
    if (status < 200 || status >= 300) {
      await this.release(userId, key);
      return;
    }

    await this.prisma.idempotencyKey
      .update({
        where: { userId_key: { userId, key } },
        data: { status, response: (body ?? null) as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
  }

  /** Frees the key so a genuine retry can run. */
  async release(userId: string, key: string): Promise<void> {
    await this.prisma.idempotencyKey
      .delete({ where: { userId_key: { userId, key } } })
      .catch(() => undefined);
  }

  async purgeExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - RETENTION_HOURS * 60 * 60 * 1000);
    const { count } = await this.prisma.idempotencyKey.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });

    return count;
  }

  private isUniqueViolation(error: unknown): boolean {
    return (error as { code?: string })?.code === 'P2002';
  }

  private stableStringify(value: unknown): string {
    if (value === null || typeof value !== 'object') {
      return JSON.stringify(value ?? null);
    }

    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(',')}]`;
    }

    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${JSON.stringify(k)}:${this.stableStringify(v)}`);

    return `{${entries.join(',')}}`;
  }
}
