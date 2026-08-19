import { IsString, IsNumber, IsEnum, IsOptional, IsPositive } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum IOUDirection {
  PAYABLE = 'PAYABLE',       // Money I need to pay
  RECEIVABLE = 'RECEIVABLE', // Money someone needs to pay me
}

export class CreateIOUDto {
  @ApiProperty({ description: 'Contact / Person name', example: 'Rahul' })
  @IsString()
  personName: string;

  @ApiProperty({ description: 'IOU amount in INR', example: 100 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: IOUDirection, description: 'Direction: PAYABLE (I owe them) or RECEIVABLE (They owe me)', example: IOUDirection.PAYABLE })
  @IsEnum(IOUDirection)
  direction: IOUDirection;

  @ApiPropertyOptional({ description: 'Reason for the expense / IOU', example: 'Pizza' })
  @IsOptional()
  @IsString()
  reason?: string;
}
