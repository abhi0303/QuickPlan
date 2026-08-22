import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { AnalyticsQueryDto } from './dto/analytics-query.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Analytics')
@Controller('api/analytics')
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('me')
  @ApiOperation({
    summary: 'Personal dashboard across all groups: totals, category pie, per-group bars, trend line',
  })
  me(@CurrentUser() userId: string, @Query() query: AnalyticsQueryDto) {
    return this.analyticsService.myAnalytics(userId, query);
  }

  @Get('groups/:groupId')
  @ApiOperation({
    summary: 'Group charts: spend by category, by member, and over time',
  })
  group(
    @CurrentUser() userId: string,
    @Param('groupId') groupId: string,
    @Query() query: AnalyticsQueryDto,
  ) {
    return this.analyticsService.groupAnalytics(userId, groupId, query);
  }
}
