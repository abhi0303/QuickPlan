import { Controller, Get } from '@nestjs/common';
import { promises as dns } from 'dns';
import * as net from 'net';
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

  // Reports how the database host resolves from inside this container and
  // whether each address is actually reachable on the Postgres port. Prisma
  // only says "can't reach"; this says which address family failed and how.
  @Get('health/net')
  async networkDiagnostics() {
    const raw = process.env.DATABASE_URL;

    if (!raw) {
      return { error: 'DATABASE_URL is not set' };
    }

    let host: string;
    let port: number;

    try {
      const url = new URL(raw);
      host = url.hostname;
      port = Number(url.port) || 5432;
    } catch {
      return { error: 'DATABASE_URL is not a parseable URL' };
    }

    let addresses: Array<{ address: string; family: number }>;

    try {
      addresses = await dns.lookup(host, { all: true, verbatim: true });
    } catch (error) {
      return {
        host,
        port,
        dns: 'failed',
        message: error instanceof Error ? error.message : String(error),
      };
    }

    const probes = [];

    for (const entry of addresses) {
      const startedAt = Date.now();

      const outcome = await new Promise<string>((resolve) => {
        const socket = net.connect({
          host: entry.address,
          port,
          family: entry.family,
        });

        const finish = (result: string) => {
          socket.destroy();
          resolve(result);
        };

        socket.setTimeout(5000);
        socket.on('connect', () => finish('connected'));
        socket.on('timeout', () => finish('timeout'));
        socket.on('error', (error: NodeJS.ErrnoException) =>
          finish(error.code ?? 'error'),
        );
      });

      probes.push({
        address: entry.address,
        family: `IPv${entry.family}`,
        outcome,
        ms: Date.now() - startedAt,
      });
    }

    return { host, port, resolutionOrder: probes };
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
