import { PartialType } from '@nestjs/swagger';
import { CreatePersonalExpenseDto } from './create-personal-expense.dto';

/** Scope is deliberately absent: moving an expense between ledgers is a
 *  different operation, not an edit. */
export class UpdatePersonalExpenseDto extends PartialType(CreatePersonalExpenseDto) {}
