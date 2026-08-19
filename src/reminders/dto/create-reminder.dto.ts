import { IsString, IsDateString, IsOptional, IsNumber, Min } from 'class-validator';

export class CreateReminderDto {
  @IsString()
  title: string;

  @IsDateString()
  dueAt: string;

  @IsOptional()
  @IsString()
  taskId?: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  offsetMinutes?: number;

  @IsOptional()
  @IsString()
  recurrenceRule?: string; // DAILY, WEEKLY, WEEKDAYS, MONTHLY
}
