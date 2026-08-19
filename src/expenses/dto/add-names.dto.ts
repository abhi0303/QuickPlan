import { IsArray, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddNamesDto {
  @ApiProperty({ description: 'List of participant names to assign to anonymous slots', example: ['Neha', 'Vishal'] })
  @IsArray()
  @IsString({ each: true })
  names: string[];
}
