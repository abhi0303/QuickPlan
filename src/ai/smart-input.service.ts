import { Injectable, BadRequestException } from '@nestjs/common';
import { CreatedVia } from '@prisma/client';
import { ExpensesService } from '../expenses/expenses.service';
import { AiService, ExtractedIntent } from './ai.service';
import { TasksService } from '../tasks/tasks.service';
import { RemindersService } from '../reminders/reminders.service';

@Injectable()
export class SmartInputService {
  constructor(
    private aiService: AiService,
    private tasksService: TasksService,
    private remindersService: RemindersService,
    private expensesService: ExpensesService,
  ) {}

  async handleSmartInput(userId: string, text: string) {
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Input text cannot be empty.');
    }

    const parseResult = await this.aiService.processSmartInput(text);

    let createdEntity: any = null;
    let message = '';

    switch (parseResult.intent) {
      /**
       * "Spent 400 on petrol" is a complete personal expense, so voice can
       * record it. "Gave Rahul 500" is not: a sentence cannot name the group or
       * the people, so anything mentioning someone still goes to the group
       * screens rather than being guessed at.
       */
      case ExtractedIntent.PERSONAL_EXPENSE: {
        const { title, totalAmount, category } = parseResult.payload;

        createdEntity = await this.expensesService.createPersonal(userId, {
          title: title || 'Expense',
          totalAmount,
          category,
          createdVia: CreatedVia.VOICE,
        });

        message = parseResult.needsClarification
          ? `Recorded ₹${totalAmount}. ${parseResult.clarificationQuestion}`
          : `Recorded ₹${totalAmount} for ${createdEntity.title}.`;
        break;
      }

      /**
       * Anything involving other people stays in a group. A sentence cannot
       * name the group or list who was there, and guessing would post money to
       * the wrong ledger where the wrong people would see it.
       */
      case ExtractedIntent.CREATE_IOU:
      case ExtractedIntent.SPLIT_EXPENSE:
      case ExtractedIntent.SETTLE_EXPENSE: {
        const { personName } = parseResult.payload ?? {};
        const named = personName && personName !== 'Unknown' ? personName : null;

        message = named
          ? `Money involving ${named} belongs to a group, so both sides see it. Open Money to record it.`
          : 'Money shared with other people belongs to a group. Open Money to record it.';
        break;
      }

      case ExtractedIntent.CREATE_TASK:
      default: {
        const { title, dueDate, reminderOffsetMinutes, category } = parseResult.payload;

        // Marked VOICE so voice-only missions count it and manual ones do not.
        createdEntity = await this.tasksService.create(
          userId,
          { title, dueDate, category },
          CreatedVia.VOICE,
        );

        if (dueDate && parseResult.needsClarification !== true) {
          await this.remindersService.create(
            userId,
            {
              taskId: createdEntity.id,
              title: `Task Reminder: ${title}`,
              dueAt: dueDate,
              offsetMinutes: reminderOffsetMinutes || 15,
            },
            CreatedVia.VOICE,
          );
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
