import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GroupsService } from './groups.service';
import { CreateGroupDto } from './dto/create-group.dto';
import { UpdateGroupDto } from './dto/update-group.dto';
import { AddMembersDto } from './dto/add-members.dto';
import { SetRoleDto } from './dto/set-role.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Groups')
@Controller('api/groups')
export class GroupsController {
  constructor(private readonly groupsService: GroupsService) {}

  @Post()
  @ApiOperation({ summary: 'Create a group; you become its owner' })
  create(@CurrentUser() userId: string, @Body() dto: CreateGroupDto) {
    return this.groupsService.create(userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List the groups you belong to, with your net balance in each' })
  list(@CurrentUser() userId: string) {
    return this.groupsService.listMine(userId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Group detail and members (members only)' })
  findOne(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.groupsService.findOne(userId, id);
  }

  @Get(':id/balances')
  @ApiOperation({ summary: 'Who owes what, plus the fewest payments that settle it' })
  balances(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.groupsService.getBalances(userId, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or edit a group (owner only)' })
  update(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: UpdateGroupDto) {
    return this.groupsService.update(userId, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a group and everything in it (owner only)' })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.groupsService.remove(userId, id);
  }

  @Post(':id/convert-to-personal')
  @ApiOperation({
    summary: 'Turn a one-member group into personal expenses and delete it',
    description:
      'Owner only. Rejected if the group has more than one member or any recorded payment. Reversible only by re-entering the data.',
  })
  convertToPersonal(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.groupsService.convertToPersonal(userId, id);
  }

  @Post(':id/members')
  @ApiOperation({ summary: 'Add friends to the group (owner only)' })
  addMembers(@CurrentUser() userId: string, @Param('id') id: string, @Body() dto: AddMembersDto) {
    return this.groupsService.addMembers(userId, id, dto.memberIds);
  }

  @Delete(':id/members/:memberId')
  @ApiOperation({ summary: 'Remove a member (owner), or leave the group yourself' })
  removeMember(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
  ) {
    return this.groupsService.removeMember(userId, id, memberId);
  }

  @Patch(':id/members/:memberId/role')
  @ApiOperation({ summary: 'Promote a member to owner, or demote back (owner only)' })
  setRole(
    @CurrentUser() userId: string,
    @Param('id') id: string,
    @Param('memberId') memberId: string,
    @Body() dto: SetRoleDto,
  ) {
    return this.groupsService.setRole(userId, id, memberId, dto.role);
  }
}
