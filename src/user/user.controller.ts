import { Controller, Get, Post, Patch, Body, Headers } from '@nestjs/common';
import { UserService } from './user.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UpdateSettingsDto } from './dto/update-settings.dto';

@Controller('api/user')
export class UserController {
  constructor(private readonly userService: UserService) {}

  private getUserId(headers: Record<string, string>): string {
    return headers['x-user-id'] || 'default-user-id';
  }

  @Post('register')
  registerUser(@Body() createUserDto: CreateUserDto) {
    return this.userService.createUser(createUserDto);
  }

  @Get('me')
  getProfile(@Headers() headers: Record<string, string>) {
    return this.userService.getUserProfile(this.getUserId(headers));
  }

  @Patch('me')
  updateProfile(
    @Headers() headers: Record<string, string>,
    @Body() updateUserDto: UpdateUserDto,
  ) {
    return this.userService.updateUserProfile(this.getUserId(headers), updateUserDto);
  }

  @Get('settings')
  getSettings(@Headers() headers: Record<string, string>) {
    return this.userService.getSettings(this.getUserId(headers));
  }

  @Patch('settings')
  updateSettings(
    @Headers() headers: Record<string, string>,
    @Body() dto: UpdateSettingsDto,
  ) {
    return this.userService.updateSettings(this.getUserId(headers), dto);
  }
}
