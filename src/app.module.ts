import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaModule } from './prisma/prisma.module';
import { TasksModule } from './tasks/tasks.module';
import { RemindersModule } from './reminders/reminders.module';
import { ExpensesModule } from './expenses/expenses.module';
import { FriendsModule } from './friends/friends.module';
import { GroupsModule } from './groups/groups.module';
import { SettlementsModule } from './settlements/settlements.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { GamificationModule } from './gamification/gamification.module';
import { OnboardingModule } from './onboarding/onboarding.module';
import { IdempotencyModule } from './idempotency/idempotency.module';
import { BudgetsModule } from './budgets/budgets.module';
import { RecurringModule } from './recurring/recurring.module';
import { PlannerModule } from './planner/planner.module';
import { CashflowModule } from './cashflow/cashflow.module';
import { MailModule } from './mail/mail.module';
import { AiModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';
import { UserModule } from './user/user.module';
import { AuthModule } from './auth/auth.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    EventEmitterModule.forRoot(),
    // Generous by default: a device coming back online flushes its whole outbox
    // in a couple of seconds, and that is normal traffic, not abuse. The auth
    // routes that send email are tightened individually.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 120 }]),
    PrismaModule,
    TasksModule,
    RemindersModule,
    ExpensesModule,
    FriendsModule,
    GroupsModule,
    SettlementsModule,
    AnalyticsModule,
    GamificationModule,
    OnboardingModule,
    IdempotencyModule,
    BudgetsModule,
    RecurringModule,
    PlannerModule,
    CashflowModule,
    MailModule,
    AiModule,
    NotificationsModule,
    UserModule,
    AuthModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
