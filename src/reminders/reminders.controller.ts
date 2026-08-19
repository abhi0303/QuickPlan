import { Controller, Get, Post, Delete, Body, Param, Headers } from '@nestjs/common';
import { RemindersService } from './reminders.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@Controller('api/reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  create(@Headers() headers: Record<string, string>, @Body() dto: CreateReminderDto) {
    return this.remindersService.create(this.getUserId(headers), dto);
  }

  @Get()
  findAll(@Headers() headers: Record<string, string>) {
    return this.remindersService.findAll(this.getUserId(headers));
  }

  @Delete(':id')
  remove(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.remindersService.remove(this.getUserId(headers), id);
  }
}
