import { Module } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { CalendarTokenService } from './calendar-token.service';
import { RemindersController } from './reminders.controller';

@Module({
  controllers: [RemindersController],
  providers: [RemindersService, CalendarTokenService],
  exports: [RemindersService, CalendarTokenService],
})
export class RemindersModule {}
