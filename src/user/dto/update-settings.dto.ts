import { IsString, IsOptional, IsBoolean, IsNumber } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  inputLanguage?: string; // AUTO, HINDI, ENGLISH

  @IsOptional()
  @IsString()
  outputLanguage?: string; // HINDI, ENGLISH, SAME

  @IsOptional()
  @IsBoolean()
  notificationsEnabled?: boolean;

  @IsOptional()
  @IsNumber()
  defaultReminderOffsetMinutes?: number;

  @IsOptional()
  @IsString()
  defaultPriority?: string;

  @IsOptional()
  @IsString()
  defaultCategory?: string;

  @IsOptional()
  @IsString()
  currency?: string;
}
