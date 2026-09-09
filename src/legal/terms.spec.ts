import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { AcceptTermsDto } from '../user/dto/accept-terms.dto';
import {
  CURRENT_TERMS_VERSION,
  LEGACY_TERMS_VERSION,
  needsReacceptance,
} from './terms';

const signup = async (extra: Record<string, unknown>) => {
  const dto = plainToInstance(CreateUserDto, {
    name: 'Abhi',
    email: 'abhi@example.com',
    password: 'password123',
    ...extra,
  });

  return (await validate(dto)).flatMap((e) => Object.values(e.constraints ?? {}));
};

describe('signup consent', () => {
  it('accepts a ticked box with a published version', async () => {
    expect(
      await signup({ acceptedTerms: true, termsVersion: CURRENT_TERMS_VERSION }),
    ).toEqual([]);
  });

  /** Consent has to be a clear affirmative action, so anything else is a refusal. */
  it.each([
    ['omitted', undefined],
    ['false', false],
    ['the string "true"', 'true'],
    ['1', 1],
    ['null', null],
  ])('refuses when acceptedTerms is %s', async (_label, value) => {
    const errors = await signup({ acceptedTerms: value, termsVersion: CURRENT_TERMS_VERSION });

    expect(errors).toContain('Please accept the Terms of Use and Privacy Policy to continue.');
  });

  /**
   * A stale cached frontend must not be able to record consent to a version
   * that was never published - that record is worse than having none.
   */
  it.each([
    ['a version that never existed', '1999-01-01'],
    ['the server-only legacy marker', LEGACY_TERMS_VERSION],
    ['an empty string', ''],
    ['omitted', undefined],
  ])('refuses %s as a terms version', async (_label, value) => {
    const errors = await signup({ acceptedTerms: true, termsVersion: value });

    expect(errors).toContain('Unknown terms version. Reload the app and try again.');
  });

  it('applies the same version rule to the re-consent route', async () => {
    const bad = plainToInstance(AcceptTermsDto, { termsVersion: LEGACY_TERMS_VERSION });
    const good = plainToInstance(AcceptTermsDto, { termsVersion: CURRENT_TERMS_VERSION });

    expect(await validate(bad)).not.toHaveLength(0);
    expect(await validate(good)).toHaveLength(0);
  });
});

describe('needsReacceptance', () => {
  it('leaves someone on the current version alone', () => {
    expect(needsReacceptance(CURRENT_TERMS_VERSION)).toBe(false);
  });

  /**
   * The twelve accounts that predate any policy never saw one. Asking once is
   * a tap; recording agreement to something that did not exist is a lie.
   */
  it.each([
    ['a legacy account', LEGACY_TERMS_VERSION],
    ['a withdrawn version', '2020-01-01'],
    ['null', null],
    ['undefined', undefined],
  ])('asks again for %s', (_label, value) => {
    expect(needsReacceptance(value)).toBe(true);
  });
});
