import { Type } from 'class-transformer';
import { IsInt, Max, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { TOTAL_STEPS } from '../tour.config';

export class UpdateTourProgressDto {
  @ApiProperty({
    description: 'Last step the user reached, 1-based. Progress never moves backwards.',
    minimum: 1,
    maximum: TOTAL_STEPS,
    example: 3,
  })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(TOTAL_STEPS)
  step: number;
}
