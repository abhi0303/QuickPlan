import { Injectable, UnauthorizedException } from '@nestjs/common';
import { EmailVerificationService } from './email-verification.service';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
    private readonly verification: EmailVerificationService,
  ) {}

  /**
   * No access token here: the account is unusable until the address is
   * confirmed, and handing back a token that login would refuse a moment later
   * would only be confusing.
   */
  async register(dto: CreateUserDto) {
    const user = await this.userService.createUser(dto);

    await this.verification.issue(user.id, user.email, user.name);

    // Report the state that actually applies. Saying "check your inbox" when
    // no mail was sent would send somebody hunting for an email that does not
    // exist.
    const pending = this.verification.enforced();

    return {
      user: { id: user.id, name: user.name, email: user.email },
      emailVerified: !pending,
      message: pending
        ? 'Check your inbox to confirm your email, then sign in.'
        : 'Account created. You can sign in now.',
      ...(pending ? {} : { accessToken: this.jwtService.sign({ sub: user.id, email: user.email }) }),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmail(dto.email.trim().toLowerCase());
    if (!user?.passwordHash || !(await this.userService.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

    // Checked after the password, so this cannot be used to discover which
    // addresses are registered.
    this.verification.assertVerified(user);

    return this.createAuthResponse(user);
  }

  private createAuthResponse(user: { id: string; name: string; email: string }) {
    const accessToken = this.jwtService.sign({ sub: user.id, email: user.email });
    return {
      accessToken,
      user: { id: user.id, name: user.name, email: user.email },
    };
  }
}
