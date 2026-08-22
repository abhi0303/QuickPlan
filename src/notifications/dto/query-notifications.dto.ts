import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export enum NotificationStatus {
  ALL = 'all',
  UNREAD = 'unread',
}

export class QueryNotificationsDto {
  @ApiPropertyOptional({ default: 20, maximum: 50 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number;

  @ApiPropertyOptional({ description: 'Opaque cursor from the previous page' })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({ enum: NotificationStatus, default: NotificationStatus.ALL })
  @IsOptional()
  @IsEnum(NotificationStatus)
  status?: NotificationStatus;
}
