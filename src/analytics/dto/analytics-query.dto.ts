import { IsEnum, IsISO8601, IsOptional } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum TimeBucket {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
}

export class AnalyticsQueryDto {
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
