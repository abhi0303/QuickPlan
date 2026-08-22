import { IsISO8601, IsNumber, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateSettlementDto {
  @ApiProperty({ description: 'Member who received the money' })
  @IsUUID()
  toUserId: string;

  @ApiProperty({ example: 500 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiPropertyOptional({ description: 'Who paid. Defaults to you.' })
  @IsOptional()
  @IsUUID()
  fromUserId?: string;

  @ApiPropertyOptional({ example: 'Paid by UPI' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;

  @ApiPropertyOptional({ description: 'When it was paid, ISO 8601. Defaults to now.' })
  @IsOptional()
  @IsISO8601()
  settledAt?: string;
}
