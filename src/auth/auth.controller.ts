import { Body, Controller, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { CreateUserDto } from '../user/dto/create-user.dto';
import { Public } from './public.decorator';
import { Protected } from './protected.decorator';
import { PasswordResetService } from './password-reset.service';
import { ChangePasswordDto, ForgotPasswordDto, ResetPasswordDto } from './dto/password.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Authentication')
@Controller('api/auth')
@Public()
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly passwords: PasswordResetService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register with email and password' })
  register(@Body() dto: CreateUserDto) {
    return this.authService.register(dto);
  }

  @Post('login')
  @ApiOperation({ summary: 'Login with email and password' })
  login(@Body() dto: LoginDto) {
    return this.authService.login(dto);
  }

  @Post('forgot-password')
  @ApiOperation({
    summary: 'Ask for a reset link',
    description:
      'Always answers the same way, whether or not the address has an account — otherwise this endpoint would reveal who is registered.',
  })
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwords.forgot(dto);
  }

  @Post('reset-password')
  @ApiOperation({
    summary: 'Set a new password using the token from the email',
    description: 'The link is single-use and expires after an hour.',
  })
  resetPassword(@Body() dto: ResetPasswordDto) {
    return this.passwords.reset(dto);
  }

  // Signed in already; proves knowledge of the current password rather than
  // possession of the mailbox.
  @Protected()
  @Patch('change-password')
  @ApiOperation({ summary: 'Change your password while signed in' })
  changePassword(@CurrentUser() userId: string, @Body() dto: ChangePasswordDto) {
    return this.passwords.change(userId, dto);
  }
}
