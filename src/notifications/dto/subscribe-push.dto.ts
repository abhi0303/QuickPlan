import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubscribePushDto {
  @ApiProperty({
    description: 'Push endpoint issued by the browser vendor',
    example: 'https://web.push.apple.com/sample_endpoint',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'Web Push P256DH public key', example: 'BIPpSAMPLEKEY123' })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({ description: 'Web Push auth secret', example: '8eTSAMPLEAUTH456' })
  @IsString()
  @IsNotEmpty()
  auth: string;

  @ApiPropertyOptional({ description: 'Device description, kept for debugging' })
  @IsOptional()
  @IsString()
  userAgent?: string;
}
