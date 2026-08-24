import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { GamificationService } from './gamification.service';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Gamification')
@Controller('api/gamification')
export class GamificationController {
  constructor(private readonly gamification: GamificationService) {}

  @Get()
  @ApiOperation({
    summary: 'XP, level, rank and the three current missions',
    description:
      'Also retires an expired cycle and deals a new one, so the response is always current.',
  })
  getState(@CurrentUser() userId: string) {
    return this.gamification.getState(userId);
  }

  @Get('catalogue')
  @ApiOperation({
    summary: 'Static mission definitions, for resolving titles and icons by type',
  })
  getCatalogue() {
    return this.gamification.getCatalogue();
  }
}
