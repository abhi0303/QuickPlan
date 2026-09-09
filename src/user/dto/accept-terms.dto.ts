import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';
import { PUBLISHED_TERMS_VERSIONS } from '../../legal/terms';

export class AcceptTermsDto {
  @ApiProperty({ description: 'The published policy version being accepted.', example: '2026-09-10' })
  @IsIn(PUBLISHED_TERMS_VERSIONS as string[], {
    message: 'Unknown terms version. Reload the app and try again.',
  })
  termsVersion: string;
}
