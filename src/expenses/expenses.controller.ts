import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  Headers,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateIOUDto } from './dto/create-iou.dto';
import { SplitExpenseDto } from './dto/split-expense.dto';
import { AddNamesDto } from './dto/add-names.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';

@ApiTags('Expenses & IOUs')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  // JwtAuthGuard overwrites x-user-id with the verified token subject, so this
  // is the authenticated user. Failing loudly beats writing rows under a
  // placeholder id if the guard is ever removed from this route.
  private getUserId(headers: Record<string, string>): string {
    const userId = headers['x-user-id'];

    if (!userId) {
      throw new UnauthorizedException('Authenticated user could not be resolved.');
    }

    return userId;
  }

  @Post('iou')
  @ApiOperation({ summary: 'Record payable or receivable IOU' })
  createIOU(@Headers() headers: Record<string, string>, @Body() dto: CreateIOUDto) {
    return this.expensesService.createIOU(this.getUserId(headers), dto);
  }

  @Post('split')
  @ApiOperation({ summary: 'Split expense among N participants (named & anonymous)' })
  splitExpense(@Headers() headers: Record<string, string>, @Body() dto: SplitExpenseDto) {
    return this.expensesService.splitExpense(this.getUserId(headers), dto);
  }

  @Patch(':id/add-names')
  @ApiOperation({ summary: 'Add names to anonymous participants later' })
  addNames(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() dto: AddNamesDto,
  ) {
    return this.expensesService.addNamesToExpense(this.getUserId(headers), id, dto);
  }

  @Patch('participants/:participantId/settle')
  @ApiOperation({ summary: 'Settle individual participant share (mark paid)' })
  settleParticipant(
    @Headers() headers: Record<string, string>,
    @Param('participantId') participantId: string,
  ) {
    return this.expensesService.settleParticipant(this.getUserId(headers), participantId);
  }

  @Get()
  @ApiOperation({
    summary: 'List expenses, filtered by direction, type, status, contact or date',
  })
  findAll(
    @Headers() headers: Record<string, string>,
    @Query() query: QueryExpensesDto,
  ) {
    return this.expensesService.findAll(this.getUserId(headers), query);
  }

  // Declared before ':id' so the literal path is not captured as an id.
  @Get('summary')
  @ApiOperation({ summary: 'Totals for what you owe and what you are owed' })
  getSummary(@Headers() headers: Record<string, string>) {
    return this.expensesService.getSummary(this.getUserId(headers));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get specific expense details' })
  findOne(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.expensesService.findOne(this.getUserId(headers), id);
  }
}
