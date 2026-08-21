import { Controller, Get, Headers, Logger, NotFoundException } from '@nestjs/common';
import { timingSafeEqual } from 'crypto';
import { promises as dns } from 'dns';
import * as net from 'net';
import { AppService } from './app.service';
import { PrismaService } from './prisma/prisma.service';
import { Public } from './auth/public.decorator';

const DIAGNOSTICS_HEADER = 'x-diagnostics-token';

@Controller()
@Public()
export class AppController {
  private readonly logger = new Logger(AppController.name);

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

  // The database connects lazily, so a successful boot says nothing about
  // whether queries actually work. This answers that. Details go to the logs
  // rather than the response, since the endpoint is public.
  @Get('health/db')
  async databaseHealthCheck() {
    const startedAt = Date.now();

    try {
      await this.prisma.$queryRaw`select 1`;
      return { database: 'reachable', latencyMs: Date.now() - startedAt };
    } catch (error) {
      this.logger.error(
        `Database health check failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return { database: 'unreachable', latencyMs: Date.now() - startedAt };
    }
  }

  /**
   * Reports how the database host resolves from inside this container and
   * whether each address is reachable on the Postgres port. Prisma only ever
   * says "can't reach"; this says which address family failed and with what
   * errno - the difference between a routing problem, a blocked port and a
   * DNS problem.
   *
   * Gated behind DIAGNOSTICS_TOKEN because it discloses internal topology.
   * With no token configured the route does not exist at all.
   */
  @Get('health/net')
  async networkDiagnostics(@Headers(DIAGNOSTICS_HEADER) token?: string) {
    this.assertDiagnosticsAllowed(token);

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

  // A wrong or missing token is reported as 404 rather than 401 so the route
  // does not advertise itself to anyone scanning the API.
  private assertDiagnosticsAllowed(token?: string) {
    const expected = process.env.DIAGNOSTICS_TOKEN;

    if (!expected || !token) {
      throw new NotFoundException();
    }

    const provided = Buffer.from(token);
    const target = Buffer.from(expected);

    if (
      provided.length !== target.length ||
      !timingSafeEqual(provided, target)
    ) {
      throw new NotFoundException();
    }
  }
}
