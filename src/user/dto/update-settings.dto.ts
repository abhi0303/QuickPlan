import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateSettingsDto {
  @ApiPropertyOptional({ description: 'Preferred input language: AUTO, HINDI, ENGLISH', example: 'AUTO' })
  @IsOptional()
  @IsString()
  inputLanguage?: string;

  @ApiPropertyOptional({ description: 'Preferred output language: SAME, HINDI, ENGLISH', example: 'SAME' })
  @IsOptional()
  @IsString()
  outputLanguage?: string;

  @ApiPropertyOptional({ description: 'Notification master toggle flag', example: true })
  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @ApiPropertyOptional({ description: 'Default reminder offset minutes', example: 15 })
  @IsOptional()
  @IsNumber()
  defaultReminderOffsetMinutes?: number;

  @ApiPropertyOptional({ description: 'Default task priority: LOW, MEDIUM, HIGH, URGENT', example: 'MEDIUM' })
  @IsOptional()
  @IsString()
  defaultPriority?: string;

  @ApiPropertyOptional({ description: 'Default task category', example: 'General' })
  @IsOptional()
  @IsString()
  defaultCategory?: string;

  @ApiPropertyOptional({ description: 'Default currency symbol/code', example: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;
}
