import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { QueryExpensesDto } from './dto/query-expenses.dto';
import { CreatePersonalExpenseDto } from './dto/create-personal-expense.dto';
import { QueryPersonalExpensesDto } from './dto/query-personal-expenses.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Expenses')
@Controller('api')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Post('groups/:groupId/expenses')
  @ApiOperation({ summary: 'Add an expense to a group' })
  create(
    @CurrentUser() userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: CreateExpenseDto,
  ) {
    return this.expensesService.create(userId, groupId, dto);
  }

  @Get('groups/:groupId/expenses')
  @ApiOperation({ summary: 'List a group\'s expenses, filtered by category, payer or date' })
  findAll(
    @CurrentUser() userId: string,
    @Param('groupId') groupId: string,
    @Query() query: QueryExpensesDto,
  ) {
    return this.expensesService.findAll(userId, groupId, query);
  }

  // Declared before ':id' so the literal path is not captured as an id.
  @Post('expenses')
  @ApiOperation({
    summary: 'Record a personal expense — no group, no payer, no split',
  })
  createPersonal(
    @CurrentUser() userId: string,
    @Body() dto: CreatePersonalExpenseDto,
    @Req() request: Request,
  ) {
    // The raw body, because the validation pipe whitelists group fields away
    // before they reach the DTO - and silently ignoring them would hide a
    // client bug rather than reporting it.
    return this.expensesService.createPersonal(userId, dto, request.body);
  }

  @Get('expenses')
  @ApiOperation({ summary: 'Your personal expenses, newest first by date' })
  findAllPersonal(@CurrentUser() userId: string, @Query() query: QueryPersonalExpensesDto) {
    return this.expensesService.findAllPersonal(userId, query);
  }

  @Get('expenses/:id')
  @ApiOperation({ summary: 'Expense detail (group members only)' })
  findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.expensesService.findOne(userId, id);
  }

  @Patch('expenses/:id')
  @ApiOperation({ summary: 'Edit an expense (author or group owner)' })
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateExpenseDto) {
    return this.expensesService.update(userId, id, dto);
  }

  @Delete('expenses/:id')
  @ApiOperation({ summary: 'Delete an expense (author or group owner)' })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.expensesService.remove(userId, id);
  }
}
