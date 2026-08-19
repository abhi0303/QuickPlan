import { Controller, Get, Post, Patch, Body, Param, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateIOUDto } from './dto/create-iou.dto';
import { SplitExpenseDto } from './dto/split-expense.dto';
import { AddNamesDto } from './dto/add-names.dto';

@ApiTags('Expenses & IOUs')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
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
  @ApiOperation({ summary: 'List all user expenses' })
  findAll(@Headers() headers: Record<string, string>) {
    return this.expensesService.findAll(this.getUserId(headers));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get specific expense details' })
  findOne(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.expensesService.findOne(this.getUserId(headers), id);
  }
}
