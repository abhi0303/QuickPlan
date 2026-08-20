import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './auth/public.decorator';

@Controller()
@Public()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly prisma: PrismaService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // Kept shallow on purpose: Render restarts the service when its health check
  // fails, so a database blip must not trigger a restart loop.
  @Get('health')
  healthCheck() {
    return { status: 'ok' };
  }

  // Deep probe for diagnosing connectivity from inside the deployed container,
  // where the database is reachable or not for reasons a local run cannot show.
  @Get('health/db')
  async databaseHealthCheck() {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`select 1`;
      return { database: 'reachable', latencyMs: Date.now() - startedAt };
    } catch (error) {
      // Prisma messages are multi-line and start with blank lines, so pick the
      // first line that actually carries text.
      const raw = error instanceof Error ? error.message : String(error);
      const summary = raw
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .find((line) => !line.startsWith('Invalid `'));

      return {
        database: 'unreachable',
        latencyMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : 'Unknown',
        errorCode: (error as { errorCode?: string }).errorCode ?? null,
        message: summary ?? raw.trim(),
      };
    }
  }
}
