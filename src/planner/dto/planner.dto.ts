import { IsBoolean, IsNumber, IsOptional, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpsertPlanDto {
  @ApiProperty({ description: 'Take-home pay per month', example: 85000 })
  @IsNumber()
  @Min(0)
  monthlyIncome: number;

  @ApiPropertyOptional({ description: 'Optional "I want to save this much"', example: 20000 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  savingsTarget?: number;
}

export class UpdatePlanItemDto {
  @ApiPropertyOptional({ description: 'Switch a line out of the plan' })
  @IsOptional()
  @IsBoolean()
  included?: boolean;

  @ApiPropertyOptional({
    description: 'Replace the estimate with a typed figure. Null resumes tracking history.',
    example: 7500,
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amountOverride?: number | null;
}
