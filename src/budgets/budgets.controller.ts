import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { BudgetsService } from './budgets.service';
import {
  BudgetStatusQueryDto,
  CreateBudgetDto,
  SuggestBudgetQueryDto,
  UpdateBudgetDto,
} from './dto/budget.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Budgets')
@Controller('api/budgets')
export class BudgetsController {
  constructor(private readonly budgets: BudgetsService) {}

  @Get()
  @ApiOperation({ summary: 'Your active budgets' })
  list(@CurrentUser() userId: string) {
    return this.budgets.list(userId);
  }

  // Declared before ':id' so the literal paths are not captured as ids.
  @Get('status')
  @ApiOperation({
    summary: 'Everything the rings need: spent, remaining, projected and status',
  })
  status(@CurrentUser() userId: string, @Query() query: BudgetStatusQueryDto) {
    return this.budgets.status(userId, query.period, query.periodType);
  }

  @Get('suggest')
  @ApiOperation({
    summary: "Last period's spending, to pre-fill a budget nobody knows how to size",
  })
  suggest(@CurrentUser() userId: string, @Query() query: SuggestBudgetQueryDto) {
    return this.budgets.suggest(userId, query.category, query.period);
  }

  @Post()
  @ApiOperation({ summary: 'Set a budget. Omit category for an overall one.' })
  create(@CurrentUser() userId: string, @Body() dto: CreateBudgetDto) {
    return this.budgets.create(userId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Change the amount or scope' })
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateBudgetDto) {
    return this.budgets.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Archive a budget — past periods keep the limit that was in force',
  })
  archive(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.budgets.archive(userId, id);
  }
}
