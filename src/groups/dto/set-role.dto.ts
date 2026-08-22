import { IsEnum } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { GroupRole } from '@prisma/client';

export class SetRoleDto {
  @ApiProperty({
    enum: GroupRole,
    description: 'Promote to OWNER to let this member manage and delete the group',
  })
  @IsEnum(GroupRole)
  role: GroupRole;
}
