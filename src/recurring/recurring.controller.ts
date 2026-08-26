import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { RecurringService } from './recurring.service';
import { CreateRecurringDto, UpdateRecurringDto } from './dto/recurring.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Recurring expenses')
@Controller('api/recurring')
export class RecurringController {
  constructor(private readonly recurring: RecurringService) {}

  @Get()
  @ApiOperation({ summary: 'Your recurring expenses with their next run date' })
  list(@CurrentUser() userId: string) {
    return this.recurring.list(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Schedule a repeating expense' })
  create(@CurrentUser() userId: string, @Body() dto: CreateRecurringDto) {
    return this.recurring.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edit, pause or resume' })
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateRecurringDto) {
    return this.recurring.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Stop the schedule. Expenses it created stay.' })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.recurring.remove(userId, id);
  }

  @Post(':id/skip-next')
  @ApiOperation({ summary: 'Move the next run on by one cadence, creating nothing' })
  skipNext(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.recurring.skipNext(userId, id);
  }

  @Post(':id/run-now')
  @ApiOperation({ summary: "Create this period's expense early" })
  runNow(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.recurring.runNow(userId, id);
  }
}
