import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CashflowService } from './cashflow.service';
import { QueryCashflowDto } from './dto/cashflow.dto';
import { CurrentUser } from '../common/current-user.decorator';

@ApiTags('Cash flow')
@Controller('api/cashflow')
export class CashflowController {
  constructor(private readonly cashflow: CashflowService) {}

  @Get()
  @ApiOperation({
    summary: 'Everything that actually moved your money, newest first',
    description:
      'What left your account, not what it cost you: the full amount of any bill you fronted, plus every settlement. Derived on request — nothing is stored.',
  })
  list(@CurrentUser() userId: string, @Query() query: QueryCashflowDto) {
    return this.cashflow.list(userId, query);
  }
}
