import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { CreateUserDto } from './create-user.dto';

/**
 * NPCI's shape for a virtual payment address: a handle, an @, and a bank or
 * PSP suffix. Worth validating rather than storing free text - a typo here
 * surfaces as somebody else's payment going nowhere, which is a far worse way
 * to find out.
 */
const UPI_ID = /^[a-zA-Z0-9](?:[a-zA-Z0-9.\-_]{0,60}[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]{1,63}$/;

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    example: 'abhinav@okhdfcbank',
    description: 'UPI VPA shown to people who owe you money. Send null to remove it.',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Matches(UPI_ID, {
    message: 'That does not look like a UPI ID. It should read like name@bank.',
  })
  upiId?: string | null;
}
