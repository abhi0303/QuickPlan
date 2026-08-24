import { IsString, IsOptional, IsEnum, IsBoolean, IsDateString } from 'class-validator';
import { CreatedVia } from '@prisma/client';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum TaskPriority {
  LOW = 'LOW',
  MEDIUM = 'MEDIUM',
  HIGH = 'HIGH',
  URGENT = 'URGENT',
}

export enum TaskStatus {
  PENDING = 'PENDING',
  IN_PROGRESS = 'IN_PROGRESS',
  COMPLETED = 'COMPLETED',
}

export class CreateTaskDto {
  @ApiProperty({ description: 'Title of the task', example: 'Call Rahul to discuss project' })
  @IsString()
  title: string;

  @ApiPropertyOptional({ description: 'Additional notes or sub-details', example: 'Review report beforehand' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiPropertyOptional({ enum: TaskStatus, description: 'Task current status', example: TaskStatus.PENDING })
  @IsOptional()
  @IsEnum(TaskStatus)
  status?: TaskStatus;

  @ApiPropertyOptional({ enum: TaskPriority, description: 'Task priority level', example: TaskPriority.HIGH })
  @IsOptional()
  @IsEnum(TaskPriority)
  priority?: TaskPriority;

  @ApiPropertyOptional({ description: 'Task category / tag', example: 'Work' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Due date in ISO 8601 string format', example: '2026-08-20T10:00:00.000Z' })
  @IsOptional()
  @IsDateString()
  dueDate?: string;

  @ApiPropertyOptional({ description: 'Completion status flag', example: false })
  @IsOptional()
  @IsBoolean()
  isCompleted?: boolean;

  @ApiPropertyOptional({
    enum: CreatedVia,
    default: CreatedVia.MANUAL,
    description:
      'How this task was created. The client parses speech on-device and posts here, so VOICE has to come from the caller.',
  })
  @IsOptional()
  @IsEnum(CreatedVia)
  createdVia?: CreatedVia;
}
