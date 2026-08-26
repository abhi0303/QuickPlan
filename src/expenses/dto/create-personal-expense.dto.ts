import {
  IsEnum,
  IsISO8601,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CreatedVia } from '@prisma/client';

export class CreatePersonalExpenseDto {
  @ApiProperty({ example: 'Petrol' })
  @IsString()
  @IsNotEmpty()
  @Length(1, 120)
  title: string;

  @ApiProperty({ example: 400 })
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @ApiPropertyOptional({ description: 'Free text, drives the breakdown charts', example: 'Fuel' })
  @IsOptional()
  @IsString()
  @Length(1, 40)
  category?: string;

  @ApiPropertyOptional({ description: 'When it happened, ISO 8601. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  date?: string;

  @ApiPropertyOptional({ example: 'Indian Oil, Sector 18' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  @ApiPropertyOptional({
    enum: CreatedVia,
    default: CreatedVia.MANUAL,
    description: 'VOICE lets voice expense missions count this one.',
  })
  @IsOptional()
  @IsEnum(CreatedVia)
  createdVia?: CreatedVia;
}
