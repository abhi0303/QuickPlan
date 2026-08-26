import { Module } from '@nestjs/common';
import { BudgetsService } from './budgets.service';
import { BudgetsController } from './budgets.controller';
import { BudgetsListener } from './budgets.listener';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [BudgetsController],
  providers: [BudgetsService, BudgetsListener],
  exports: [BudgetsService],
})
export class BudgetsModule {}
