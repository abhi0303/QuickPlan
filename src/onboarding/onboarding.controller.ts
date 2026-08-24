import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { OnboardingService } from './onboarding.service';
import { UpdateTourProgressDto } from './dto/onboarding.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Onboarding')
@Controller('api/onboarding')
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Get()
  @ApiOperation({
    summary: 'Tour steps, whether to show it, and where to resume',
  })
  getTour(@CurrentUser() userId: string) {
    return this.onboarding.getTour(userId);
  }

  @Patch('progress')
  @ApiOperation({ summary: 'Record the step the user reached' })
  saveProgress(@CurrentUser() userId: string, @Body() dto: UpdateTourProgressDto) {
    return this.onboarding.saveProgress(userId, dto.step);
  }

  @Post('complete')
  @ApiOperation({ summary: 'Mark the tour finished. Idempotent.' })
  complete(@CurrentUser() userId: string) {
    return this.onboarding.complete(userId);
  }

  @Post('skip')
  @ApiOperation({ summary: 'Dismiss the tour. Counts as finished.' })
  skip(@CurrentUser() userId: string) {
    return this.onboarding.skip(userId);
  }

  @Post('restart')
  @ApiOperation({ summary: 'Replay the tour from the start (Settings → Guide)' })
  restart(@CurrentUser() userId: string) {
    return this.onboarding.restart(userId);
  }
}
