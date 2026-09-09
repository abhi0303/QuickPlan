import { Equals, IsIn, IsNotEmpty, IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { PUBLISHED_TERMS_VERSIONS } from '../../legal/terms';

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

  /**
   * Must be exactly true. Consent under the DPDP Act has to be a clear
   * affirmative action, so a missing field, a string, or false are all
   * refusals rather than something to coerce.
   */
  @ApiProperty({
    description: 'Confirms the Terms of Use, Privacy Policy and being 18 or older were accepted.',
    example: true,
  })
  @Equals(true, {
    message: 'Please accept the Terms of Use and Privacy Policy to continue.',
  })
  acceptedTerms: boolean;

  /**
   * Recorded as sent, but only if we actually published it. A stale cached
   * frontend must not be able to record consent to a version that never
   * existed - that record would be worse than none.
   */
  @ApiProperty({ description: 'The published policy version accepted.', example: '2026-09-10' })
  @IsIn(PUBLISHED_TERMS_VERSIONS as string[], {
    message: 'Unknown terms version. Reload the app and try again.',
  })
  termsVersion: string;
}
