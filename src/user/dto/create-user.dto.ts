import { IsString, IsOptional, IsEmail } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiPropertyOptional({ description: 'User full name', example: 'Abhi Sharma' })
  @IsOptional()
  @IsString()
  name?: string;

  @ApiPropertyOptional({ description: 'User email address', example: 'abhi@example.com' })
  @IsOptional()
  @IsEmail()
  email?: string;
}
