import { Controller, Post, Body, Headers } from '@nestjs/common';
import { SmartInputService } from './smart-input.service';
import { IsString, IsNotEmpty } from 'class-validator';

export class SmartInputDto {
  @IsString()
  @IsNotEmpty()
  text: string;
}

@Controller('api/v1/smart-input')
export class SmartInputController {
  constructor(private readonly smartInputService: SmartInputService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post()
  processInput(@Headers() headers: Record<string, string>, @Body() dto: SmartInputDto) {
    return this.smartInputService.handleSmartInput(this.getUserId(headers), dto.text);
  }
}
