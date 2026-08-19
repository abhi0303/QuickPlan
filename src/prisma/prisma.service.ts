import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

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
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
