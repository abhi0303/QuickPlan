import { Injectable } from '@nestjs/common';

export enum ExtractedIntent {
  CREATE_TASK = 'CREATE_TASK',
  CREATE_REMINDER = 'CREATE_REMINDER',
  CREATE_IOU = 'CREATE_IOU',
  SPLIT_EXPENSE = 'SPLIT_EXPENSE',
  SETTLE_EXPENSE = 'SETTLE_EXPENSE',
  COMPLETE_TASK = 'COMPLETE_TASK',
  QUERY_TASK = 'QUERY_TASK',
  QUERY_EXPENSE = 'QUERY_EXPENSE',
  PERSONAL_EXPENSE = 'PERSONAL_EXPENSE',
}

export interface SmartParseResult {
  intent: ExtractedIntent;
  originalText: string;
  translatedText?: string;
  detectedLanguage?: string;
  needsClarification?: boolean;
  clarificationQuestion?: string;
  payload: any;
}

@Injectable()
export class AiService {
  /**
   * Main Smart Input Processor.
   * Parses natural language input (Hindi, English, Hinglish) into structured JSON.
   */
  async processSmartInput(text: string): Promise<SmartParseResult> {
    const input = text.trim();
    const lower = input.toLowerCase();

    // 1. Detect IOU payable ("dene hai", "dene hain", "give", "pay")
    if (lower.includes('dene hai') || lower.includes('dene hain') || lower.includes('pay to')) {
      return this.parseIOUPayable(input);
    }

    // 2. Detect IOU receivable ("lene hai", "lene hain", "get from", "owes me")
    if (lower.includes('lene hai') || lower.includes('lene hain') || lower.includes('owes me')) {
      return this.parseIOUReceivable(input);
    }

    // 3. Detect Expense Split ("divide", "split", "logo mein divide")
    if (lower.includes('divide') || lower.includes('split') || lower.includes('logo mein') || lower.includes('logon mein')) {
      return this.parseExpenseSplit(input);
    }

    // 4. Detect Expense Settlement ("de diye", "paid me", "settle")
    if (lower.includes('de diye') || lower.includes('paid me') || lower.includes('settled')) {
      return this.parseSettlement(input);
    }

    // 5. Money handed to a named person is an IOU, not a personal expense -
    // "gave Rahul 500" needs a group so both sides see it.
    if (this.mentionsGivingSomeone(lower) && this.extractAmount(input) > 0) {
      return this.parseIOUPayable(input);
    }

    // 6. A personal expense: an amount, a spending verb, and nobody else
    // involved. "Spent 400 on petrol" is complete on its own.
    if (this.looksLikePersonalSpend(lower) && this.extractAmount(input) > 0) {
      return this.parsePersonalExpense(input);
    }

    // 7. Default: Task & Reminder Creation
    return this.parseTaskAndReminder(input);
  }

  private extractAmount(input: string): number {
    const match =
      input.match(/(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i) ||
      input.match(/(\d+(?:\.\d+)?)\s*(?:rupees|rupee|rs|inr)/i) ||
      input.match(/\b(\d+(?:\.\d+)?)\b/);

    return match ? parseFloat(match[1]) : 0;
  }

  private mentionsGivingSomeone(lower: string): boolean {
    return /\b(gave|give|owe|owes|lent|paid back|diye|dena|dene)\b/.test(lower);
  }

  private looksLikePersonalSpend(lower: string): boolean {
    return /\b(spent|spend|bought|buy|kharch|kharcha|kharche|paid for|cost|bill for)\b/.test(lower);
  }

  /** Best-effort category from the words people actually use. */
  private guessCategory(lower: string): string {
    const table: Array<[RegExp, string]> = [
      [/petrol|diesel|fuel|gas station/, 'Fuel'],
      [/grocer|vegetable|sabzi|supermarket|kirana/, 'Groceries'],
      [/coffee|tea|chai|lunch|dinner|breakfast|food|restaurant|snack|pizza/, 'Food'],
      [/uber|ola|cab|taxi|auto|bus|train|flight|metro/, 'Travel'],
      [/rent/, 'Rent'],
      [/medicine|doctor|pharmacy|hospital|clinic/, 'Health'],
      [/movie|cinema|game|concert/, 'Entertainment'],
      [/recharge|bill|electricity|water|internet|wifi|mobile/, 'Bills'],
      [/shirt|clothes|shoes|shopping/, 'Shopping'],
    ];

    return table.find(([pattern]) => pattern.test(lower))?.[1] ?? 'General';
  }

  private parsePersonalExpense(input: string): SmartParseResult {
    const lower = input.toLowerCase();
    const amount = this.extractAmount(input);

    // The thing bought usually follows "on", "for" or "ka".
    const subject =
      // "spent 400 on petrol" / "bill for medicine"
      input.match(/\b(?:on|for)\s+([a-z\u0900-\u097F][\w\u0900-\u097F\s]{1,40})/i)?.[1] ??
      // "bought coffee for 150" - the thing follows the verb, not a preposition
      input.match(/\b(?:bought|buy)\s+([a-z\u0900-\u097F][\w\u0900-\u097F\s]{1,40}?)(?:\s+for\b|\s*$)/i)?.[1] ??
      input.match(/([a-z\u0900-\u097F][\w\u0900-\u097F\s]{1,40})\s*(?:ka|ke|ki)\s*kharch/i)?.[1];

    const title = subject?.trim().replace(/\s+/g, ' ');
    const category = this.guessCategory(lower);

    return {
      intent: ExtractedIntent.PERSONAL_EXPENSE,
      originalText: input,
      needsClarification: !title,
      clarificationQuestion: title ? undefined : 'What was it for?',
      payload: {
        title: title ? title.charAt(0).toUpperCase() + title.slice(1) : 'Expense',
        totalAmount: amount,
        category,
      },
    };
  }

  private parseIOUPayable(input: string): SmartParseResult {
    // Example: "Rahul ko 100 rupee dene hai pizza ke"
    // Example: "Kal 5 baje Rahul ko pizza ke 100 rupee dene hain aur 30 minute pehle yaad dila dena"

    const amountMatch = input.match(/(?:₹|\b|rupee|rs|inr)\s*(\d+(?:\.\d+)?)/i) || input.match(/(\d+)\s*(?:rupee|rs|rupees|inr)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

    // Extract Person name before 'ko' or 'to'
    const personMatch = input.match(/([A-Z][a-z]+|[a-zA-Z]+)\s+(?:ko|to)/i);
    const personName = personMatch ? personMatch[1].trim() : 'Unknown';

    // Extract reason e.g. "pizza ke" or "for pizza"
    let reason = 'Expense';
    const reasonBeforeKe = input.match(/([a-zA-Z0-9]+)\s+ke\b/i);
    const reasonAfterFor = input.match(/for\s+([a-zA-Z0-9]+)/i);

    if (reasonBeforeKe && !['dene', 'lene', 'ko', 'se', 'hai', 'hain'].includes(reasonBeforeKe[1].toLowerCase())) {
      reason = reasonBeforeKe[1].trim();
    } else if (reasonAfterFor) {
      reason = reasonAfterFor[1].trim();
    }

    // Extract Due Date / Time
    const dueDate = this.extractDateTime(input);

    // Extract Reminder Offset (e.g., "30 minute pehle yaad dila dena")
    const reminderOffset = this.extractReminderOffset(input);

    return {
      intent: ExtractedIntent.CREATE_IOU,
      originalText: input,
      payload: {
        personName,
        amount,
        direction: 'PAYABLE',
        reason,
        dueDate: dueDate ? dueDate.toISOString() : null,
        reminderOffsetMinutes: reminderOffset,
      },
    };
  }

  private parseIOUReceivable(input: string): SmartParseResult {
    // Example: "Rahul se 200 lene hain."
    const amountMatch = input.match(/(?:₹|\b|rupee|rs|inr)\s*(\d+(?:\.\d+)?)/i) || input.match(/(\d+)\s*(?:rupee|rs|rupees|inr)/i);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

    const personMatch = input.match(/([A-Z][a-z]+|[a-zA-Z]+)\s+(?:se|from)/i);
    const personName = personMatch ? personMatch[1].trim() : 'Unknown';

    const reasonMatch = input.match(/(?:ke|for)\s+([a-zA-Z0-9\s]+?)(?=\s+(?:lene|get|200|\d+)|\s*$)/i);
    const reason = reasonMatch ? reasonMatch[1].trim() : 'Expense';

    return {
      intent: ExtractedIntent.CREATE_IOU,
      originalText: input,
      payload: {
        personName,
        amount,
        direction: 'RECEIVABLE',
        reason,
      },
    };
  }

  private parseExpenseSplit(input: string): SmartParseResult {
    // Example: "500 rupee ko 5 logo mein divide kar do aur maine pay kiya hai."
    // Example: "500 rupee Rahul, Amit, Neha aur Vishal ke saath split kiye."

    const amountMatch = input.match(/(?:₹|\b|rupee|rs|inr)\s*(\d+(?:\.\d+)?)/i) || input.match(/(\d+)\s*(?:rupee|rs|rupees|inr)/i);
    const totalAmount = amountMatch ? parseFloat(amountMatch[1]) : 0;

    const countMatch = input.match(/(\d+)\s*(?:logo|logon|people|persons|members)/i);
    let participantsCount = countMatch ? parseInt(countMatch[1], 10) : 2;

    // Extract names if present e.g. "Rahul, Amit, Neha aur Vishal"
    const names: string[] = [];
    const namesSectionMatch = input.match(/(?:with|saath)\s+([a-zA-Z,\s]+?)(?=\s+ke|\s+split|\s+$)/i);
    if (namesSectionMatch) {
      const rawNames = namesSectionMatch[1].split(/,|aur|and|\s+/).filter((n) => n.trim().length > 1);
      names.push(...rawNames.map((n) => n.trim()));
      if (names.length > 0) {
        participantsCount = names.length + 1; // Me + named persons
      }
    }

    return {
      intent: ExtractedIntent.SPLIT_EXPENSE,
      originalText: input,
      payload: {
        title: 'Group Expense Split',
        totalAmount,
        participantsCount,
        paidByMe: true,
        names,
      },
    };
  }

  private parseSettlement(input: string): SmartParseResult {
    // Example: "Rahul ne 100 de diye."
    const amountMatch = input.match(/(\d+)/);
    const amount = amountMatch ? parseFloat(amountMatch[1]) : 0;

    const personMatch = input.match(/([A-Z][a-z]+|[a-zA-Z]+)\s+(?:ne|paid|has)/i);
    const personName = personMatch ? personMatch[1].trim() : 'Unknown';

    return {
      intent: ExtractedIntent.SETTLE_EXPENSE,
      originalText: input,
      payload: {
        personName,
        amount,
      },
    };
  }

  private parseTaskAndReminder(input: string): SmartParseResult {
    // Example: "Kal subah 10 baje Rahul ko call karna hai."
    // Example: "Kal grocery leni hai."

    const lower = input.toLowerCase();

    // Check date/time presence
    const dueDate = this.extractDateTime(input);
    const isCallOrMeeting = lower.includes('call') || lower.includes('meeting') || lower.includes('phone') || lower.includes('appointment');

    let needsClarification = false;
    let clarificationQuestion: string | undefined;

    // Requirement 2: Ask for missing time on time-sensitive tasks (like call/appointment)
    if (isCallOrMeeting && dueDate && dueDate.getHours() === 0 && dueDate.getMinutes() === 0) {
      needsClarification = true;
      clarificationQuestion = 'What time would you prefer for this call/appointment?';
    }

    const title = input
      .replace(/kal|subah|shaam|baje|ko|karna hai|lenas hai|chahiye|reminder|yaad dila/gi, '')
      .trim() || input;

    const reminderOffset = this.extractReminderOffset(input);

    return {
      intent: ExtractedIntent.CREATE_TASK,
      originalText: input,
      needsClarification,
      clarificationQuestion,
      payload: {
        title: title.charAt(0).toUpperCase() + title.slice(1),
        dueDate: dueDate ? dueDate.toISOString() : null,
        reminderOffsetMinutes: reminderOffset,
        category: isCallOrMeeting ? 'Calls & Meetings' : 'General',
      },
    };
  }

  private extractDateTime(input: string): Date | null {
    const lower = input.toLowerCase();
    const now = new Date();
    let target = new Date();

    if (lower.includes('kal') || lower.includes('tomorrow')) {
      target.setDate(now.getDate() + 1);
    } else if (lower.includes('aaj') || lower.includes('today')) {
      target.setDate(now.getDate());
    } else {
      return null;
    }

    // Extract time e.g. "10 baje", "5 baje", "9 AM", "5 PM"
    const timeMatch = input.match(/(\d{1,2})\s*(?:baje|am|pm|:00)/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      if (lower.includes('shaam') || lower.includes('pm') || lower.includes('raat')) {
        if (hours < 12) hours += 12;
      } else if (lower.includes('subah') || lower.includes('am')) {
        if (hours === 12) hours = 0;
      }
      target.setHours(hours, 0, 0, 0);
    } else {
      target.setHours(0, 0, 0, 0);
    }

    return target;
  }

  private extractReminderOffset(input: string): number {
    // Example: "30 minute pehle yaad dila dena", "2 hours before"
    const match = input.match(/(\d+)\s*(?:minute|min|ghante|hour|hours|hr|hrs)/i);
    if (!match) return 15; // default 15 mins

    const val = parseInt(match[1], 10);
    if (input.toLowerCase().includes('ghante') || input.toLowerCase().includes('hour')) {
      return val * 60;
    }
    return val;
  }
}
