import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UserService } from '../user/user.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly userService: UserService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: CreateUserDto) {
    const user = await this.userService.createUser(dto);
    return this.createAuthResponse(user);
  }

  async login(dto: LoginDto) {
    const user = await this.userService.findByEmail(dto.email.trim().toLowerCase());
    if (!user?.passwordHash || !(await this.userService.verifyPassword(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password.');
    }

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
