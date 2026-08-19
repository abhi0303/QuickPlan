import { IsString, IsNumber, IsOptional, IsArray, IsBoolean, IsPositive, Min } from 'class-validator';

export class SplitExpenseDto {
  @IsString()
  title: string;

  @IsNumber()
  @IsPositive()
  totalAmount: number;

  @IsNumber()
  @Min(2)
  participantsCount: number;

  @IsOptional()
  @IsBoolean()
  paidByMe?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  names?: string[];
}
