import { IsString, IsNumber, IsEnum, IsOptional, IsPositive } from 'class-validator';

export enum IOUDirection {
  PAYABLE = 'PAYABLE',       // Money I need to pay
  RECEIVABLE = 'RECEIVABLE', // Money someone needs to pay me
}

export class CreateIOUDto {
  @IsString()
  personName: string;

  @IsNumber()
  @IsPositive()
  amount: number;

  @IsEnum(IOUDirection)
  direction: IOUDirection;

  @IsOptional()
  @IsString()
  reason?: string;
}
