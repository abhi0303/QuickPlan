import { IsEnum, IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { ExpenseStatus, ExpenseType } from '@prisma/client';

export enum ExpenseDirection {
  I_OWE = 'I_OWE',
  OWED_TO_ME = 'OWED_TO_ME',
}

export class QueryExpensesDto {
  @ApiPropertyOptional({
    enum: ExpenseDirection,
    description: 'I_OWE lists money you must pay, OWED_TO_ME money due to you',
  })
  @IsOptional()
  @IsEnum(ExpenseDirection)
  direction?: ExpenseDirection;

  @ApiPropertyOptional({ enum: ExpenseType })
  @IsOptional()
  @IsEnum(ExpenseType)
  type?: ExpenseType;

  @ApiPropertyOptional({ enum: ExpenseStatus })
  @IsOptional()
  @IsEnum(ExpenseStatus)
  status?: ExpenseStatus;

  @ApiPropertyOptional({ description: 'Only expenses involving this contact' })
  @IsOptional()
  @IsUUID()
  personId?: string;

  @ApiPropertyOptional({ description: 'Created on or after (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Created on or before (ISO 8601)' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 50, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}
