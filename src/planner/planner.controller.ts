import { Body, Controller, Delete, Get, Param, Patch, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PlannerService } from './planner.service';
import { UpdatePlanItemDto, UpsertPlanDto } from './dto/planner.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Budget planner')
@Controller('api/planner')
export class PlannerController {
  constructor(private readonly planner: PlannerService) {}

  @Get()
  @ApiOperation({
    summary: 'The whole computed plan — income, commitments, estimates and what is left',
    description: 'Arrives ready to render; the client does no arithmetic.',
  })
  get(@CurrentUser() userId: string) {
    return this.planner.get(userId);
  }

  @Put()
  @ApiOperation({
    summary: 'Set income. A change archives the current plan and replaces it.',
  })
  upsert(@CurrentUser() userId: string, @Body() dto: UpsertPlanDto) {
    return this.planner.upsert(userId, dto);
  }

  @Patch('items/:id')
  @ApiOperation({ summary: 'Switch a line off, or replace its estimate' })
  updateItem(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Body() dto: UpdatePlanItemDto,
  ) {
    return this.planner.updateItem(userId, id, dto);
  }

  @Post('recalculate')
  @ApiOperation({ summary: 'Refresh the estimates from history now' })
  recalculate(@CurrentUser() userId: string) {
    return this.planner.recalculate(userId);
  }

  @Delete()
  @ApiOperation({ summary: 'Archive the plan' })
  archive(@CurrentUser() userId: string) {
    return this.planner.archive(userId);
  }
}
