import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SmartInputService } from './smart-input.service';
import { SmartInputController } from './smart-input.controller';
import { TasksModule } from '../tasks/tasks.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { RemindersModule } from '../reminders/reminders.module';
import { PeopleModule } from '../people/people.module';

@Module({
  imports: [TasksModule, ExpensesModule, RemindersModule, PeopleModule],
  controllers: [SmartInputController],
  providers: [AiService, SmartInputService],
  exports: [AiService, SmartInputService],
})
export class AiModule {}
