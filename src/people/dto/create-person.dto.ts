import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePersonDto {
  @ApiProperty({ description: 'Full name of the contact', example: 'Rahul Sharma' })
  @IsString()
  name: string;

  @ApiPropertyOptional({ description: 'Optional nickname', example: 'Rahul' })
  @IsOptional()
  @IsString()
  nickname?: string;

  @ApiPropertyOptional({ description: 'Contact phone number', example: '+919876543210' })
  @IsOptional()
  @IsString()
  phone?: string;

  @ApiPropertyOptional({ description: 'Contact email address', example: 'rahul@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
