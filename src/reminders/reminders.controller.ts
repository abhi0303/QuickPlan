import { Controller, Get, Post, Delete, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { RemindersService } from './reminders.service';
import { CreateReminderDto } from './dto/create-reminder.dto';

@ApiTags('Reminders')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/reminders')
export class RemindersController {
  constructor(private readonly remindersService: RemindersService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  @ApiOperation({ summary: 'Create reminder with offset minutes' })
  create(@Headers() headers: Record<string, string>, @Body() dto: CreateReminderDto) {
    return this.remindersService.create(this.getUserId(headers), dto);
  }

  @Get()
  @ApiOperation({ summary: 'List all user reminders' })
  findAll(@Headers() headers: Record<string, string>) {
    return this.remindersService.findAll(this.getUserId(headers));
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete reminder by ID' })
  remove(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.remindersService.remove(this.getUserId(headers), id);
  }
}
