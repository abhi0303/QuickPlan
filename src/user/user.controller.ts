import { Body, Controller, Delete, Get, HttpCode, Patch, Post } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { AcceptTermsDto } from './dto/accept-terms.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { CurrentUser } from '../common/current-user.decorator';
import { Public } from '../auth/public.decorator';

@ApiTags('User & Settings')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Post('register')
  @Public()
  @ApiOperation({ summary: 'Register a new user profile with default settings' })
  registerUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and settings' })
  getProfile(@CurrentUser() userId: string) {
    return this.userService.getUserProfile(userId);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update user profile (name, email)' })
  updateProfile(
    @CurrentUser() userId: string,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateUserProfile(userId, updateUserDto);
  }

  @Post('accept-terms')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Record acceptance of the current Terms of Use and Privacy Policy',
    description:
      'Its own route rather than a field on PATCH /me, so accepting terms can never be a side effect of editing a profile.',
  })
  acceptTerms(@CurrentUser() userId: string, @Body() dto: AcceptTermsDto) {
    return this.userService.acceptTerms(userId, dto.termsVersion);
  }

  @Delete('me')
  @ApiOperation({
    summary: 'Delete your account',
    description:
      'Personal data is erased. Group expenses and settlements stay, with the account shown as a removed member, because deleting them would rewrite other people\'s balances.',
  })
  deleteAccount(@CurrentUser() userId: string, @Body() dto: DeleteAccountDto) {
    return this.userService.deleteAccount(userId, dto.currentPassword);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get user configuration settings' })
  getSettings(@CurrentUser() userId: string) {
    return this.userService.getSettings(userId);
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user configuration settings' })
  updateSettings(
    @CurrentUser() userId: string,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.userService.updateSettings(userId, dto);
  }
}
