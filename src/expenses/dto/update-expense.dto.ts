import { PartialType } from '@nestjs/swagger';
import { CreateExpenseDto } from './create-expense.dto';

/**
 * Any field may be edited. Changing the amount, split type or shares recomputes
 * every share, so balances stay consistent with the new figures.
 */
export class UpdateExpenseDto extends PartialType(CreateExpenseDto) {}
