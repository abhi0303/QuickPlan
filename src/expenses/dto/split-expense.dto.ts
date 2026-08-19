import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsPositive, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SplitExpenseDto {
  @ApiProperty({ description: 'Title or reason for group expense', example: 'Pizza Party' })
  @IsString()
  title: string;

  @ApiProperty({ description: 'Total expense amount in INR', example: 500 })
  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @ApiProperty({ description: 'Total number of participants sharing the bill (including Me)', example: 5 })
  @IsNumber()
  @Min(2)
  participantsCount: number;

  @ApiPropertyOptional({ description: 'Flag indicating if current user paid the full bill upfront', example: true, default: true })
  @IsOptional()
  @IsBoolean()
  paidByMe?: boolean;

  @ApiPropertyOptional({ description: 'Optional list of participant names (if known upfront)', example: ['Rahul', 'Amit', 'Neha'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  names?: string[];
}
