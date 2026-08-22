import { IsArray, IsBoolean, IsOptional, IsUUID, ValidateIf } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class MarkReadDto {
  @ApiPropertyOptional({
    description: 'Notification ids to mark read. Required unless `all` is true.',
    type: [String],
  })
  @ValidateIf((dto: MarkReadDto) => dto.all !== true)
  @IsArray()
  @IsUUID(undefined, { each: true })
  ids?: string[];

  @ApiPropertyOptional({ description: 'Mark every notification read' })
  @IsOptional()
  @IsBoolean()
  all?: boolean;
}
