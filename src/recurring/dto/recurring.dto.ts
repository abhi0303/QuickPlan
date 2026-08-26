import {
  IsEnum,
  IsISO8601,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseScope, RecurringCadence } from '@prisma/client';

export class CreateRecurringDto {
  @ApiProperty({ example: 'Rent' })
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiProperty({ example: 18000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: RecurringCadence, example: RecurringCadence.MONTHLY })
  @IsEnum(RecurringCadence)
  cadence: RecurringCadence;

  @ApiPropertyOptional({ example: 'Rent' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @ApiPropertyOptional({
    enum: ExpenseScope,
    default: ExpenseScope.PERSONAL,
    description: 'GROUP requires groupId and splits equally across members at run time.',
  })
  @IsOptional()
  @IsEnum(ExpenseScope)
  scope?: ExpenseScope;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  groupId?: string;

  @ApiPropertyOptional({
    description: 'MONTHLY only, 1-31. Clamped to the last day in shorter months.',
    minimum: 1,
    maximum: 31,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dayOfMonth?: number;

  @ApiPropertyOptional({ description: 'WEEKLY only. 0 is Sunday.', minimum: 0, maximum: 6 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(6)
  weekday?: number;

  @ApiPropertyOptional({ description: 'First run. Defaults to the next occurrence from today.' })
  @IsOptional()
  @IsISO8601()
  startsOn?: string;

  @ApiPropertyOptional({ description: 'Stop after this date' })
  @IsOptional()
  @IsISO8601()
  endsOn?: string;
}

export class UpdateRecurringDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 120)
  title?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @ApiPropertyOptional({ description: 'true pauses it, false resumes' })
  @IsOptional()
  paused?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsISO8601()
  endsOn?: string;
}
