import { Injectable, BadRequestException } from '@nestjs/common';
import { AiService, ExtractedIntent } from './ai.service';
import { TasksService } from '../tasks/tasks.service';
import { RemindersService } from '../reminders/reminders.service';

@Injectable()
export class SmartInputService {
  constructor(
    private aiService: AiService,
    private tasksService: TasksService,
    private remindersService: RemindersService,
  ) {}

  async handleSmartInput(userId: string, text: string) {
    if (!text || text.trim().length === 0) {
      throw new BadRequestException('Input text cannot be empty.');
    }

    const parseResult = await this.aiService.processSmartInput(text);

    let createdEntity: any = null;
    let message = '';

    switch (parseResult.intent) {
      // Money now lives in shared groups, and a sentence carries no group
      // context - "I owe Rahul 500" cannot say which group it belongs to, or
      // who else should see it. Rather than guess and post to the wrong
      // ledger, these intents hand the user back to the group screens.
      case ExtractedIntent.CREATE_IOU:
      case ExtractedIntent.SPLIT_EXPENSE:
      case ExtractedIntent.SETTLE_EXPENSE: {
        message =
          'Expenses belong to a group now. Open the group and add it there, so every member sees it.';
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
