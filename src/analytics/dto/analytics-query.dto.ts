import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum TimeBucket {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export enum AnalyticsScope {
  PERSONAL = 'PERSONAL',
  GROUP = 'GROUP',
  ALL = 'ALL',
}

export class AnalyticsQueryDto {
  @ApiPropertyOptional({
    enum: AnalyticsScope,
    default: AnalyticsScope.ALL,
    description:
      'PERSONAL: your own expenses. GROUP: your share of group expenses. ALL: both, which is what actually left your money.',
  })
  @IsOptional()
  @IsEnum(AnalyticsScope)
  scope?: AnalyticsScope;

  @ApiPropertyOptional({ description: 'Start of the window, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'End of the window, ISO 8601' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ enum: TimeBucket, default: TimeBucket.MONTH })
  @IsOptional()
  @IsEnum(TimeBucket)
  bucket?: TimeBucket;
}
