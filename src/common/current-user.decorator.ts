import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';

/**
 * The authenticated user's id. JwtAuthGuard verifies the token and puts the
 * subject on the request, so handlers never have to read a header that a
 * client could otherwise try to set.
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): string => {
  const request = ctx.switchToHttp().getRequest();
  const userId = request.user?.sub ?? request.headers?.['x-user-id'];

  if (!userId) {
    throw new UnauthorizedException('Authenticated user could not be resolved.');
  }

  return userId;
});
