import { Module } from '@nestjs/common';
import { AiService } from './ai.service';
import { SmartInputService } from './smart-input.service';
import { SmartInputController } from './smart-input.controller';
import { TasksModule } from '../tasks/tasks.module';
import { RemindersModule } from '../reminders/reminders.module';

@Module({
  imports: [TasksModule, RemindersModule],
  controllers: [SmartInputController],
  providers: [AiService, SmartInputService],
  exports: [AiService, SmartInputService],
})
export class AiModule {}
