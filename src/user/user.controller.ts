import { Controller, Get, Post, Patch, Body, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiHeader } from '@nestjs/swagger';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@ApiTags('User & Settings')
@ApiHeader({ name: 'x-user-id', required: false, description: 'User ID header' })
@Controller('api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user profile with default settings' })
  registerUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Get('me')
  @ApiOperation({ summary: 'Get current user profile and settings' })
  getProfile(@Headers() headers: Record<string, string>) {
    return this.userService.getUserProfile(this.getUserId(headers));
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update user profile (name, email)' })
  updateProfile(
    @Headers() headers: Record<string, string>,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateUserProfile(this.getUserId(headers), updateUserDto);
  }

  @Get('settings')
  @ApiOperation({ summary: 'Get user configuration settings' })
  getSettings(@Headers() headers: Record<string, string>) {
    return this.userService.getSettings(this.getUserId(headers));
  }

  @Patch('settings')
  @ApiOperation({ summary: 'Update user configuration settings' })
  updateSettings(
    @Headers() headers: Record<string, string>,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.userService.updateSettings(this.getUserId(headers), dto);
  }
}
