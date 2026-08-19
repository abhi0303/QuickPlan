import { Controller, Get, Post, Patch, Body, Param, Headers } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateIOUDto } from './dto/create-iou.dto';
import { SplitExpenseDto } from './dto/split-expense.dto';
import { AddNamesDto } from './dto/add-names.dto';

@Controller('api/expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post('iou')
  createIOU(@Headers() headers: Record<string, string>, @Body() dto: CreateIOUDto) {
    return this.expensesService.createIOU(this.getUserId(headers), dto);
  }

  @Post('split')
  splitExpense(@Headers() headers: Record<string, string>, @Body() dto: SplitExpenseDto) {
    return this.expensesService.splitExpense(this.getUserId(headers), dto);
  }

  @Patch(':id/add-names')
  addNames(
    @Headers() headers: Record<string, string>,
    @Param('id') id: string,
    @Body() dto: AddNamesDto,
  ) {
    return this.expensesService.addNamesToExpense(this.getUserId(headers), id, dto);
  }

  @Patch('participants/:participantId/settle')
  settleParticipant(
    @Headers() headers: Record<string, string>,
    @Param('participantId') participantId: string,
  ) {
    return this.expensesService.settleParticipant(this.getUserId(headers), participantId);
  }

  @Get()
  findAll(@Headers() headers: Record<string, string>) {
    return this.expensesService.findAll(this.getUserId(headers));
  }

  @Get(':id')
  findOne(@Headers() headers: Record<string, string>, @Param('id') id: string) {
    return this.expensesService.findOne(this.getUserId(headers), id);
  }
}
