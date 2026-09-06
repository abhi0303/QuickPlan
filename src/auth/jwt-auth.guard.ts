import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token is required.');
    }

    try {
      const token = authorization.slice('Bearer '.length);
      const payload = this.jwtService.verify<{ sub: string; iat?: number }>(token, {
        secret: this.config.get<string>('JWT_SECRET', 'quickplan-development-secret-change-me'),
      });

      if (!payload.sub) throw new UnauthorizedException('Invalid bearer token.');

      // A password change must end sessions that were already open, or a reset
      // would leave whoever prompted it still signed in. JWTs are stateless, so
      // the cut-off is compared here.
      if (await this.issuedBeforePasswordChange(payload)) {
        throw new UnauthorizedException('Your password changed. Please sign in again.');
      }

      request.user = payload;
      request.headers['x-user-id'] = payload.sub;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired bearer token.');
    }
  }

  private async issuedBeforePasswordChange(payload: { sub: string; iat?: number }): Promise<boolean> {
    if (!payload.iat) {
      return false;
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { passwordChangedAt: true },
    });

    if (!user?.passwordChangedAt) {
      return false;
    }

    // iat has second precision, so a token minted in the same second as the
    // change is given the benefit of the doubt rather than logging someone
    // straight back out of the session they just created.
    return payload.iat * 1000 < user.passwordChangedAt.getTime() - 1000;
  }
}
