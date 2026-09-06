import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './dto/update-user.dto';

const check = async (upiIds: unknown) => {
  const dto = plainToInstance(UpdateUserDto, { upiIds });
  const errors = await validate(dto, { whitelist: true });
  return { dto, ok: errors.length === 0 };
};

describe('UpdateUserDto · upiIds', () => {
  it.each([
    'abhinav@okhdfcbank',
    'abhi.singh@ybl',
    '9876543210@paytm',
    'a_b-c.d@axl',
  ])('accepts %s', async (value) => {
    expect((await check([value])).ok).toBe(true);
  });

  it.each([
    ['no suffix', 'abhinav@'],
    ['no handle', '@okhdfcbank'],
    ['no separator', 'abhinavokhdfcbank'],
    ['a numeric bank', 'abhi@123'],
    ['a trailing dot', 'abhi.@ybl'],
    ['an email, which is the likely mistake', 'abhi@gmail.com'],
    ['spaces inside', 'abhi singh@ybl'],
  ])('rejects %s', async (_label, value) => {
    expect((await check([value])).ok).toBe(false);
  });

  /** One bad entry must not be saved alongside the good ones. */
  it('rejects the whole list if any entry is malformed', async () => {
    expect((await check(['abhinav@okhdfcbank', 'nonsense'])).ok).toBe(false);
  });

  it('keeps several, in the order given', async () => {
    const { dto, ok } = await check(['abhinav@okhdfcbank', 'abhinav@ybl', 'abhinav@paytm']);

    expect(ok).toBe(true);
    expect(dto.upiIds).toEqual(['abhinav@okhdfcbank', 'abhinav@ybl', 'abhinav@paytm']);
  });

  /** Copy-paste from a banking app routinely brings whitespace with it. */
  it('trims each entry', async () => {
    const { dto } = await check(['  abhinav@okhdfcbank  ']);
    expect(dto.upiIds).toEqual(['abhinav@okhdfcbank']);
  });

  /**
   * VPAs are case-insensitive, so these are one account. Showing both would
   * ask the payer to choose between two identical options.
   */
  it('folds case and drops duplicates, keeping the first', async () => {
    const { dto } = await check(['Abhinav@OkHdfcBank', 'abhinav@okhdfcbank', 'abhinav@ybl']);
    expect(dto.upiIds).toEqual(['abhinav@okhdfcbank', 'abhinav@ybl']);
  });

  it('drops empty entries rather than failing on a stray blank row', async () => {
    const { dto, ok } = await check(['abhinav@ybl', '', '   ']);

    expect(ok).toBe(true);
    expect(dto.upiIds).toEqual(['abhinav@ybl']);
  });

  it('caps the list at five', async () => {
    const six = ['a@ybl', 'b@ybl', 'c@ybl', 'd@ybl', 'e@ybl', 'f@ybl'];
    expect((await check(six)).ok).toBe(false);
    expect((await check(six.slice(0, 5))).ok).toBe(true);
  });

  it.each([
    ['an empty list', []],
    ['null', null],
  ])('accepts %s to clear them', async (_label, value) => {
    const { dto, ok } = await check(value);

    expect(ok).toBe(true);
    expect(dto.upiIds).toEqual([]);
  });

  it('rejects a bare string, which is the obvious mistake', async () => {
    expect((await check('abhinav@ybl')).ok).toBe(false);
  });

  it('ignores it when absent, so other fields can be patched alone', async () => {
    const dto = plainToInstance(UpdateUserDto, { name: 'Abhi' });

    expect(await validate(dto)).toHaveLength(0);
    expect(dto.upiIds).toBeUndefined();
  });
});
