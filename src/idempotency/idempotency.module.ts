import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyService } from './idempotency.service';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyScheduler } from './idempotency.scheduler';

@Global()
@Module({
  providers: [
    IdempotencyService,
    IdempotencyScheduler,
    { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor },
  ],
  exports: [IdempotencyService],
})
export class IdempotencyModule {}
