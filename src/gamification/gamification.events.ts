/**
 * Activity events the mission engine listens for. The feature modules emit
 * these and know nothing about missions, XP or levels.
 */
export const ACTIVITY_EVENT = 'activity';

export type ActivityKind =
  | 'EXPENSE_CREATED'
  | 'TASK_CREATED'
  | 'TASK_COMPLETED'
  | 'REMINDER_CREATED'
  | 'REMINDER_COMPLETED';

export class ActivityEvent {
  constructor(
    readonly kind: ActivityKind,
    readonly userId: string,
  ) {}
}
