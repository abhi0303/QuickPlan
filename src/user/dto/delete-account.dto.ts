import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class DeleteAccountDto {
  /**
   * A live session is not proof of ownership - the same reasoning as
   * change-password. Erasure is irreversible, so it asks for the password.
   */
  @ApiProperty({ description: 'Your current password, to confirm it is really you.' })
  @IsString()
  @IsNotEmpty()
  currentPassword: string;
}
