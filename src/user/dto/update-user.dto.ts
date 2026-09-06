import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, Matches } from 'class-validator';
import { Transform } from 'class-transformer';
import { CreateUserDto } from './create-user.dto';

/**
 * NPCI's shape for a virtual payment address: a handle, an @, and a bank or
 * PSP suffix. Worth validating rather than storing free text - a typo here
 * surfaces as somebody else's payment going nowhere, which is a far worse way
 * to find out.
 */
const UPI_ID = /^[a-z0-9](?:[a-z0-9.\-_]{0,60}[a-z0-9])?@[a-z][a-z0-9]{1,63}$/;

/** Enough for a bank handle, a wallet or two, and a spare. */
const MAX_UPI_IDS = 5;

/**
 * VPAs are case-insensitive, so `Abhi@ybl` and `abhi@ybl` are one account.
 * Storing them canonically keeps the payer from having to guess whether two
 * near-identical entries are two different places to send money.
 */
const normalise = (value: unknown): unknown => {
  if (value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    return value;
  }

  const seen = new Set<string>();

  return value
    .map((entry) => (typeof entry === 'string' ? entry.trim().toLowerCase() : entry))
    .filter((entry) => {
      if (typeof entry !== 'string' || entry === '') {
        return typeof entry !== 'string';
      }
      if (seen.has(entry)) {
        return false;
      }
      seen.add(entry);

      return true;
    });
};

export class UpdateUserDto extends PartialType(CreateUserDto) {
  @ApiPropertyOptional({
    type: [String],
    example: ['abhinav@okhdfcbank', 'abhinav@ybl'],
    description:
      'UPI VPAs shown to people who owe you money, best one first. Send [] or null to remove them all.',
  })
  @IsOptional()
  @Transform(({ value }) => normalise(value))
  @IsArray({ message: 'upiIds must be a list of UPI IDs.' })
  @ArrayMaxSize(MAX_UPI_IDS, { message: `You can save up to ${MAX_UPI_IDS} UPI IDs.` })
  @Matches(UPI_ID, {
    each: true,
    message: 'That does not look like a UPI ID. It should read like name@bank.',
  })
  upiIds?: string[];
}
