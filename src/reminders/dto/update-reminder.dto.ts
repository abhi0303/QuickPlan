import { PartialType } from '@nestjs/swagger';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsISO8601, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { CreateReminderDto } from './create-reminder.dto';

export class UpdateReminderDto extends PartialType(CreateReminderDto) {
  @ApiPropertyOptional({ description: 'Reminder title', example: 'Call Rahul' })
  @IsOptional()
  @IsString()
  title?: string;

  @ApiPropertyOptional({ description: 'Due moment, ISO 8601 (UTC)' })
  @IsOptional()
  @IsISO8601()
  dueAt?: string;

  @ApiPropertyOptional({ description: 'Alert this many minutes before dueAt', example: 30 })
  @IsOptional()
  @IsInt()
  @Min(0)
  offsetMinutes?: number;

  @ApiPropertyOptional({ description: 'DAILY, WEEKDAYS, WEEKLY or MONTHLY' })
  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @ApiPropertyOptional({ description: 'Associated task id' })
  @IsOptional()
  @IsString()
  taskId?: string;
}
