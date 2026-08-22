import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SettlementsService } from './settlements.service';
import { CreateSettlementDto } from './dto/create-settlement.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Settlements')
@Controller('api')
export class SettlementsController {
  constructor(private readonly settlementsService: SettlementsService) {}

  @Post('groups/:groupId/settlements')
  @ApiOperation({ summary: 'Record a payment from one member to another' })
  create(
    @CurrentUser() userId: string,
    @Param('groupId') groupId: string,
    @Body() dto: CreateSettlementDto,
  ) {
    return this.settlementsService.create(userId, groupId, dto);
  }

  @Get('groups/:groupId/settlements')
  @ApiOperation({ summary: 'Payment history for a group' })
  findAll(@CurrentUser() userId: string, @Param('groupId') groupId: string) {
    return this.settlementsService.findAll(userId, groupId);
  }

  @Delete('settlements/:id')
  @ApiOperation({ summary: 'Undo a recorded payment' })
  remove(@CurrentUser() userId: string, @Param('id') id: string) {
    return this.settlementsService.remove(userId, id);
  }
}
