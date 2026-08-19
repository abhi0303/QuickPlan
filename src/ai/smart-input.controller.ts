import { Controller, Post, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader, ApiProperty } from '@nestjs/swagger';
import { SmartInputService } from './smart-input.service';
import { IsString, IsNotEmpty } from 'class-validator';

export class SmartInputDto {
  @ApiProperty({
    description: 'Natural language text or voice transcript in Hindi, English, or Hinglish',
    example: 'Kal 5 baje Rahul ko pizza ke 100 rupee dene hain aur 30 minute pehle yaad dila dena',
  })
  @IsString()
  @IsNotEmpty()
  text: string;
}

@ApiTags('AI Smart Input')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/v1/smart-input')
export class SmartInputController {
  constructor(private readonly smartInputService: SmartInputService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  @ApiOperation({ summary: 'Process voice or natural language text into structured action' })
  processInput(@Headers() headers: Record<string, string>, @Body() dto: SmartInputDto) {
    return this.smartInputService.handleSmartInput(this.getUserId(headers), dto.text);
  }
}
