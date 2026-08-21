import { IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class UnsubscribePushDto {
  @ApiProperty({
    description: 'The endpoint to forget, as returned by the browser',
    example: 'https://web.push.apple.com/sample_endpoint',
  })
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}
