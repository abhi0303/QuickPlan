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

  @Get('outstanding')
  @ApiOperation({
    summary: 'How much of your money is out with other people, and with whom',
    description:
      'Netted per counterparty across every group you belong to. Derived from the same balances the group view shows — nothing is stored.',
  })
  outstanding(@CurrentUser() userId: string) {
    return this.cashflow.outstanding(userId);
  }
}
