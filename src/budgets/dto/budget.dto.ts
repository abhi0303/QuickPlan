import { Type } from 'class-transformer';
import {
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  Matches,
} from 'class-validator';
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { BudgetPeriod, BudgetScope } from '@prisma/client';

export class CreateBudgetDto {
  @ApiPropertyOptional({
    description: 'Omit for an overall budget covering everything.',
    example: 'Food',
  })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @ApiProperty({ example: 8000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ enum: BudgetPeriod, default: BudgetPeriod.MONTHLY })
  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @ApiPropertyOptional({ enum: BudgetScope, default: BudgetScope.PERSONAL })
  @IsOptional()
  @IsEnum(BudgetScope)
  scope?: BudgetScope;

  @ApiPropertyOptional({ description: 'First period this applies to. Defaults to today.' })
  @IsOptional()
  @IsISO8601()
  startsOn?: string;
}

export class UpdateBudgetDto {
  @ApiPropertyOptional({ example: 9000 })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  @ApiPropertyOptional({ enum: BudgetScope })
  @IsOptional()
  @IsEnum(BudgetScope)
  scope?: BudgetScope;
}

export class BudgetStatusQueryDto {
  @ApiPropertyOptional({
    description: '"2026-08" for monthly, "2026-W34" for weekly. Defaults to the current period.',
    example: '2026-08',
  })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2]|W\d{1,2})$/, {
    message: 'period must look like 2026-08 or 2026-W34',
  })
  period?: string;

  @ApiPropertyOptional({ enum: BudgetPeriod, default: BudgetPeriod.MONTHLY })
  @IsOptional()
  @IsEnum(BudgetPeriod)
  periodType?: BudgetPeriod;
}

export class SuggestBudgetQueryDto {
  @ApiPropertyOptional({ description: 'Category to suggest a budget for' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ enum: BudgetPeriod, default: BudgetPeriod.MONTHLY })
  @IsOptional()
  @IsEnum(BudgetPeriod)
  period?: BudgetPeriod;

  @ApiPropertyOptional({ enum: BudgetScope, default: BudgetScope.PERSONAL })
  @IsOptional()
  @IsEnum(BudgetScope)
  scope?: BudgetScope;
}
