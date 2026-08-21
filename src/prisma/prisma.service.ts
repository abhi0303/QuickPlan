import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { createHash } from 'crypto';
import { Pool, neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import * as ws from 'ws';

// Neon's driver needs a WebSocket implementation when it runs outside a browser.
neonConfig.webSocketConstructor = ws;

/**
 * ====================================================================
 * PRISMA DATABASE SERVICE (NestJS DB Connection Bridge)
 * ====================================================================
 * This service manages the database lifecycle (connect on module init,
 * disconnect on module destroy).
 *
 * HOW TO CHANGE DATABASE CONFIGURATION:
 * 1. Edit connection URL in `.env`:
 *    - SQLite:      DATABASE_URL="file:./dev.db"
 *    - PostgreSQL:  DATABASE_URL="postgresql://user:pass@localhost:5432/dbname"
 *    - MySQL:       DATABASE_URL="mysql://user:pass@localhost:3306/dbname"
 *
 * 2. Edit database provider in `prisma/schema.prisma`:
 *    datasource db {
 *      provider = "sqlite" // or "postgresql", "mysql"
 *      url      = env("DATABASE_URL")
 *    }
 *
 * 3. Run database migrations:
 *    npx prisma db push
 * ====================================================================
 */
const MAX_CONNECT_ATTEMPTS = 5;
const BASE_RETRY_DELAY_MS = 1000;

/**
 * Prisma's native engine resolves the database host with getaddrinfo, which
 * prefers IPv6 per RFC 6724 and does not fall back to IPv4. Hosts without IPv6
 * egress (Render, among others) therefore fail with P1001 even though the IPv4
 * address is reachable. Routing queries through Neon's driver puts the
 * connection on Node's networking stack, which does fall back.
 */
function buildNeonAdapter(): PrismaNeon | undefined {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    return undefined;
  }

  return new PrismaNeon(new Pool({ connectionString }));
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    super({ adapter: buildNeonAdapter() });
  }

  async onModuleInit() {
    this.logConnectionIdentity();

    // Neon suspends idle compute, so the first connection after a quiet period
    // has to wait for the database to wake back up. Retry instead of letting a
    // cold start take the whole app down at boot.
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt++) {
      try {
        await this.$connect();
        this.logger.log(`Database connected (attempt ${attempt})`);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (attempt === MAX_CONNECT_ATTEMPTS) {
          // Prisma also connects lazily on the first query, so a failed warm-up
          // must not stop the HTTP server from starting - otherwise every
          // request, preflights included, gets no response at all.
          this.logger.error(
            `Database unreachable after ${attempt} attempts, continuing without a warm connection: ${message}`,
          );
          return;
        }

        const delay = BASE_RETRY_DELAY_MS * 2 ** (attempt - 1);
        this.logger.warn(
          `Database connection attempt ${attempt} failed, retrying in ${delay}ms`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Records which credentials this instance is actually using. Environments
   * disagree quietly - a stale password in a dashboard variable overrides the
   * committed .env and surfaces only as an auth error on the first query. The
   * fingerprint makes two deployments comparable without exposing the secret.
   */
  private logConnectionIdentity() {
    const raw = process.env.DATABASE_URL;

    if (!raw) {
      this.logger.error('DATABASE_URL is not set');
      return;
    }

    try {
      const url = new URL(raw);
      const fingerprint = createHash('sha256')
        .update(url.password)
        .digest('hex')
        .slice(0, 8);

      this.logger.log(
        `Using database ${url.pathname.replace(/^\//, '')} at ${url.hostname} ` +
          `as ${url.username} (password fingerprint ${fingerprint})`,
      );
    } catch {
      this.logger.error('DATABASE_URL is not a parseable URL');
    }
  }
}
