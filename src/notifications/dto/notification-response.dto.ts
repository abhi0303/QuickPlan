import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { NotificationType } from '@prisma/client';

/** Documented so the client has a schema instead of an untyped 200. */
export class NotificationActorDto {
  @ApiProperty() id: string;
  @ApiProperty({ nullable: true }) name: string | null;
}

export class NotificationDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: NotificationType }) type: NotificationType;
  @ApiProperty({ example: 'Added to Goa trip' }) title: string;
  @ApiProperty({ example: 'Abhinav added you to Goa trip.' }) body: string;
  @ApiProperty({ description: 'App path, no origin', example: '/groups/7c9e' }) url: string;
  @ApiPropertyOptional({ type: NotificationActorDto, nullable: true })
  actor: NotificationActorDto | null;
  @ApiPropertyOptional({ nullable: true }) groupId: string | null;
  @ApiPropertyOptional({ nullable: true }) entityId: string | null;
  @ApiProperty({ type: Object, example: {} }) data: Record<string, unknown>;
  @ApiPropertyOptional({ nullable: true, type: String, format: 'date-time' })
  readAt: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt: Date;
}

export class NotificationListDto {
  @ApiProperty({ description: 'Total unread for the user, not just this page', example: 3 })
  unreadCount: number;

  @ApiProperty({ type: [NotificationDto] })
  items: NotificationDto[];

  @ApiProperty({ nullable: true, description: 'null on the last page' })
  nextCursor: string | null;
}

export class UnreadCountDto {
  @ApiProperty({ example: 3 }) unreadCount: number;
}

export class DeleteNotificationDto {
  @ApiProperty() deleted: boolean;
  @ApiProperty() unreadCount: number;
}
