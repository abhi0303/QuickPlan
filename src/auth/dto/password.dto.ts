import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ForgotPasswordDto {
  @ApiProperty({ example: 'abhi@example.com' })
  @IsEmail()
  email: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'The token from the emailed link' })
  @IsString()
  @IsNotEmpty()
  token: string;

  @ApiProperty({ example: 'a-new-strong-password', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

export class ChangePasswordDto {
  @ApiProperty({ description: 'Your current password' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;

  @ApiProperty({ example: 'a-new-strong-password', minLength: 8 })
  @IsString()
  @MinLength(8)
  password: string;
}

export class VerifyEmailDto {
  @ApiProperty({ description: 'The token from the confirmation link' })
  @IsString()
  @IsNotEmpty()
  token: string;
}

export class ResendVerificationDto {
  @ApiProperty({ example: 'abhi@example.com' })
  @IsEmail()
  email: string;
}
