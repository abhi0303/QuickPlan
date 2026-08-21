import { Injectable, BadRequestException } from '@nestjs/common';
import { AiService, ExtractedIntent } from './ai.service';
import { TasksService } from '../tasks/tasks.service';
import { ExpensesService } from '../expenses/expenses.service';
import { RemindersService } from '../reminders/reminders.service';
import { PeopleService } from '../people/people.service';

@Injectable()
export class SmartInputService {
  constructor(
    private aiService: AiService,
    private tasksService: TasksService,
    private expensesService: ExpensesService,
    private remindersService: RemindersService,
    private peopleService: PeopleService,
  ) {}

  async handleSmartInput(userId: string, text: string) {
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Input text cannot be empty.');
    }

    const parseResult = await this.aiService.processSmartInput(text);

    let createdEntity: any = null;
    let message = '';

    switch (parseResult.intent) {
      case ExtractedIntent.CREATE_IOU: {
        const { personName, amount, direction, reason, dueDate, reminderOffsetMinutes } = parseResult.payload;

        createdEntity = await this.expensesService.createIOU(userId, {
          personName,
          amount,
          direction,
          reason,
        });

        if (dueDate) {
          await this.remindersService.create(userId, {
            title: `IOU: Pay ${personName} ₹${amount} for ${reason}`,
            dueAt: dueDate,
            offsetMinutes: reminderOffsetMinutes || 15,
          });
        }

        const dirText = direction === 'PAYABLE' ? 'payable to' : 'receivable from';
        message = `Recorded ₹${amount} ${dirText} ${personName} for ${reason}.`;
        break;
      }

      case ExtractedIntent.SPLIT_EXPENSE: {
        const { title, totalAmount, participantsCount, paidByMe, names } = parseResult.payload;

        createdEntity = await this.expensesService.splitExpense(userId, {
          title,
          totalAmount,
          participantsCount,
          paidByMe,
          names,
        });

        message = `Split ₹${totalAmount} among ${participantsCount} participants. Your share is ₹${createdEntity.myShare}.`;
        break;
      }

      case ExtractedIntent.SETTLE_EXPENSE: {
        const { personName } = parseResult.payload;
        const people = await this.peopleService.findAllWithBalances(userId);
        const person = people.find((p) => p.name.toLowerCase() === personName.toLowerCase());

        if (person) {
          // Handles both directions; matching only on the contact's own
          // participant row would silently skip anything I owe them.
          const history = await this.peopleService.getHistory(userId, person.id);
          const pendingTx = history.transactions.find((t) => t.status === 'PENDING');

          if (pendingTx) {
            createdEntity = await this.expensesService.settleWithPerson(userId, person.id);
            message = `Marked ₹${pendingTx.shareAmount} with ${personName} as settled!`;
            break;
          }
        }
        message = `Recorded settlement request for ${personName}.`;
        break;
      }

      case ExtractedIntent.CREATE_TASK:
      default: {
        const { title, dueDate, reminderOffsetMinutes, category } = parseResult.payload;

        createdEntity = await this.tasksService.create(userId, {
          title,
          dueDate,
          category,
        });

        if (dueDate && parseResult.needsClarification !== true) {
          await this.remindersService.create(userId, {
            taskId: createdEntity.id,
            title: `Task Reminder: ${title}`,
            dueAt: dueDate,
            offsetMinutes: reminderOffsetMinutes || 15,
          });
        }

        message = parseResult.needsClarification
          ? `Task created: "${title}". ${parseResult.clarificationQuestion}`
          : `Created task: "${title}".`;
        break;
      }
    }

    return {
      intent: parseResult.intent,
      message,
      needsClarification: parseResult.needsClarification || false,
      clarificationQuestion: parseResult.clarificationQuestion || null,
      result: createdEntity,
    };
  }
}
