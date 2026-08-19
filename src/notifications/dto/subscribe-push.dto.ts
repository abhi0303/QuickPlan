import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SubscribePushDto {
  @ApiProperty({ description: 'PWA Web Push Endpoint URL', example: 'https://fcm.googleapis.com/fcm/send/sample_push_token' })
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @ApiProperty({ description: 'Web Push P256DH Public Key', example: 'BIPpSAMPLEKEY123' })
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @ApiProperty({ description: 'Web Push Auth Key', example: '8eTSAMPLEAUTH456' })
  @IsString()
  @IsNotEmpty()
  auth: string;
}
