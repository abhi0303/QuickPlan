import { IsString, IsNotEmpty, IsEmail } from 'class-validator';
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
}
