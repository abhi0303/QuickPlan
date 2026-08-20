import { IsString, IsNotEmpty, IsEmail, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateUserDto {
  @ApiProperty({ description: 'User full name (mandatory)', example: 'Abhi Sharma', required: true })
  @IsNotEmpty({ message: 'Name is a mandatory field' })
  @IsString()
  name: string;

  @ApiProperty({ description: 'User email address (mandatory)', example: 'abhi@example.com', required: true })
  @IsNotEmpty({ message: 'Email is a mandatory field' })
  @IsEmail({}, { message: 'Must be a valid email address' })
  email: string;

  @ApiProperty({ description: 'Account password (mandatory)', example: 'strong-password', minLength: 8, required: true })
  @IsNotEmpty({ message: 'Password is a mandatory field' })
  @IsString()
  @MinLength(8, { message: 'Password must be at least 8 characters long' })
  password?: string;
}
