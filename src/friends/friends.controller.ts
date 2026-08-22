import { Body, Controller, Delete, Get, Param, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { FriendsService } from './friends.service';
import { AddFriendDto } from './dto/add-friend.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Friends')
@Controller('api/friends')
export class FriendsController {
  constructor(private readonly friendsService: FriendsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Search registered users by name or email' })
  search(@CurrentUser() userId: string, @Query('q') q: string) {
    return this.friendsService.searchUsers(userId, q);
  }

  @Get()
  @ApiOperation({ summary: 'List your friends' })
  list(@CurrentUser() userId: string) {
    return this.friendsService.listFriends(userId);
  }

  @Post()
  @ApiOperation({ summary: 'Add a user to your friends' })
  add(@CurrentUser() userId: string, @Body() dto: AddFriendDto) {
    return this.friendsService.addFriend(userId, dto.userId);
  }

  @Delete(':friendId')
  @ApiOperation({ summary: 'Remove a friend (shared groups and expenses are kept)' })
  remove(@CurrentUser() userId: string, @Param('friendId') friendId: string) {
    return this.friendsService.removeFriend(userId, friendId);
  }
}
