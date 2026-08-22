import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class AddFriendDto {
  @ApiProperty({ description: 'Id of the user to add, from friend search' })
  @IsUUID()
  userId: string;
}
