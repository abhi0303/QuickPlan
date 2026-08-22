import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  Min,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SplitType } from '@prisma/client';

export class ExpenseShareInputDto {
  @ApiProperty({ description: 'Group member this share belongs to' })
  @IsUUID()
  userId: string;

  @ApiProperty({
    description: 'Amount for EXACT, or percent for PERCENTAGE. Ignored for EQUAL.',
    example: 250,
  })
  // EQUAL splits ignore this field and clients send 0, so the floor is 0 rather
  // than positive. EXACT and PERCENTAGE totals are checked in the service.
  @IsNumber()
  @Min(0)
  value: number;
}

export class CreateExpenseDto {
  @ApiProperty({ example: 'Dinner at Toit' })
  @IsString()
  @Length(1, 120)
  title: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ example: 1200 })
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @ApiPropertyOptional({
    description: 'Who paid. Defaults to you. Must be a group member.',
  })
  @IsOptional()
  @IsUUID()
  paidById?: string;

  @ApiPropertyOptional({ enum: SplitType, default: SplitType.EQUAL })
  @IsOptional()
  @IsEnum(SplitType)
  splitType?: SplitType;

  @ApiPropertyOptional({
    description:
      'EQUAL: members to split between, defaults to everyone. EXACT: amounts. PERCENTAGE: percents.',
    type: [ExpenseShareInputDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ValidateNested({ each: true })
  @Type(() => ExpenseShareInputDto)
  shares?: ExpenseShareInputDto[];

  @ApiPropertyOptional({ description: 'Drives the category breakdown charts', example: 'Food' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @ApiPropertyOptional({ description: 'When it happened, ISO 8601. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  date?: string;
}
