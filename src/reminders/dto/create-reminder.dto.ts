import {
  IsEnum, IsString, IsDateString, IsOptional, IsNumber, Min } from 'class-validator';
import { CreatedVia } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateReminderDto {
  @ApiProperty({ description: 'Reminder title / message', example: 'Call Rahul' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Due date in ISO 8601 string format', example: '2026-08-20T17:00:00.000Z' })
  @IsDateString()
  dueAt: string;

  @ApiPropertyOptional({ description: 'Optional associated task ID', example: 'tsk-101' })
  @IsOptional()
  @IsString()
  taskId?: string;

  @ApiPropertyOptional({ description: 'Trigger notification N minutes before dueAt', example: 30, default: 0 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  offsetMinutes?: number;

  @ApiPropertyOptional({ description: 'Recurrence rule: DAILY, WEEKLY, WEEKDAYS, MONTHLY', example: 'DAILY' })
  @IsOptional()
  @IsString()
  recurrenceRule?: string;

  @ApiPropertyOptional({
    enum: CreatedVia,
    default: CreatedVia.MANUAL,
    description:
      'How this reminder was created. The client parses speech on-device and posts here, so VOICE has to come from the caller.',
  })
  @IsOptional()
  @IsEnum(CreatedVia)
  createdVia?: CreatedVia;
}
