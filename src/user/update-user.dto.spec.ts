import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './dto/update-user.dto';

const check = async (upiId: unknown) => {
  const dto = plainToInstance(UpdateUserDto, { upiId });
  const errors = await validate(dto, { whitelist: true });
  return { dto, ok: errors.length === 0 };
};

describe('UpdateUserDto · upiId', () => {
  it.each([
    'abhinav@okhdfcbank',
    'abhi.singh@ybl',
    '9876543210@paytm',
    'a_b-c.d@axl',
  ])('accepts %s', async (value) => {
    expect((await check(value)).ok).toBe(true);
  });

  it.each([
    ['no suffix', 'abhinav@'],
    ['no handle', '@okhdfcbank'],
    ['no separator', 'abhinavokhdfcbank'],
    ['a numeric bank', 'abhi@123'],
    ['a trailing dot', 'abhi.@ybl'],
    ['an email, which is the likely mistake', 'abhi@gmail.com'],
    ['spaces', 'abhi singh@ybl'],
  ])('rejects %s', async (_label, value) => {
    expect((await check(value)).ok).toBe(false);
  });

  /** Copy-paste from a banking app routinely brings whitespace with it. */
  it('trims before validating', async () => {
    const { dto, ok } = await check('  abhinav@okhdfcbank  ');

    expect(ok).toBe(true);
    expect(dto.upiId).toBe('abhinav@okhdfcbank');
  });

  /** Removing yours has to be possible, not just setting one. */
  it('accepts null to clear it', async () => {
    expect((await check(null)).ok).toBe(true);
  });

  it('ignores it when absent, so other fields can be patched alone', async () => {
    const dto = plainToInstance(UpdateUserDto, { name: 'Abhi' });
    expect(await validate(dto)).toHaveLength(0);
  });
});
