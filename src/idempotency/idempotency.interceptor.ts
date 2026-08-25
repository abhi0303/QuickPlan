import {
  CallHandler,
  ConflictException,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Observable, from, of, switchMap, tap, catchError, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { IDEMPOTENCY_HEADER, IdempotencyService } from './idempotency.service';

const MUTATING_METHODS = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Replays a mutation that has already been processed instead of running it
 * again. Applied globally rather than per-route: the client sends the header
 * uniformly, and an allow-list is one more thing to forget when an endpoint is
 * added.
 *
 * A request without the header behaves exactly as before, so older clients are
 * unaffected.
 */
@Injectable()
export class IdempotencyInterceptor implements NestInterceptor {
  constructor(private readonly idempotency: IdempotencyService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const response = context.switchToHttp().getResponse<Response>();

    const key = this.headerValue(request);
    const userId = this.userId(request);

    if (!key || !MUTATING_METHODS.has(request.method) || !userId) {
      return next.handle();
    }

    const requestHash = this.idempotency.hashBody(request.body);

    return from(this.idempotency.claim(userId, key, requestHash)).pipe(
      switchMap((result) => {
        if (result.outcome === 'MISMATCH') {
          // A reused key with different content is a client bug; accepting it
          // would answer one request with another's response.
          return throwError(
            () =>
              new UnprocessableEntityException(
                'This Idempotency-Key was already used with a different request body.',
              ),
          );
        }

        if (result.outcome === 'IN_FLIGHT') {
          // 409 is retry-with-backoff for this client, which is exactly right:
          // by the next attempt the original will have finished.
          return throwError(
            () =>
              new ConflictException(
                'A request with this Idempotency-Key is still being processed. Retry shortly.',
              ),
          );
        }

        if (result.outcome === 'REPLAY') {
          response.status(result.stored.status);
          response.setHeader('Idempotent-Replay', 'true');

          return of(result.stored.body);
        }

        return next.handle().pipe(
          switchMap((body) =>
            from(
              this.idempotency.record(userId, key, response.statusCode, body),
            ).pipe(switchMap(() => of(body))),
          ),
          catchError((error) =>
            // Failures are not cached, so a retry genuinely retries.
            from(this.idempotency.release(userId, key)).pipe(
              switchMap(() => throwError(() => error)),
            ),
          ),
        );
      }),
    );
  }

  private headerValue(request: Request): string | null {
    const raw = request.headers[IDEMPOTENCY_HEADER];
    const value = Array.isArray(raw) ? raw[0] : raw;

    return value?.trim() || null;
  }

  /** The guard has already put the verified subject on the request. */
  private userId(request: Request): string | null {
    const fromToken = (request as unknown as { user?: { sub?: string } }).user?.sub;
    const fromHeader = request.headers['x-user-id'];

    return fromToken ?? (Array.isArray(fromHeader) ? fromHeader[0] : fromHeader) ?? null;
  }
}
