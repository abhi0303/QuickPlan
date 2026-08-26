import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SmartInputService } from './smart-input.service';
import { SmartInputController } from './smart-input.controller';
import { TasksModule } from '../tasks/tasks.module';
import { RemindersModule } from '../reminders/reminders.module';
import { ExpensesModule } from '../expenses/expenses.module';

@Module({
  imports: [TasksModule, RemindersModule, ExpensesModule],
  controllers: [SmartInputController],
  providers: [AiService, SmartInputService],
  exports: [AiService, SmartInputService],
})
export class AiModule {}
