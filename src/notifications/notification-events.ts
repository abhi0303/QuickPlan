import { NotificationType } from '@prisma/client';

/**
 * One place where every notification's wording, destination and push behaviour
 * is decided. Keeping it out of the services means the banner and the feed row
 * can never drift apart, and the copy can be reviewed in one file.
 */
export interface NotificationInput {
  /** The recipient. Never the actor - the person who pressed the button knows. */
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  /** App path, resolved by the service worker against the app scope. */
  url: string;
  actorId?: string | null;
  groupId?: string | null;
  entityId?: string | null;
  data?: Record<string, unknown>;
  /** A later push with the same tag replaces the earlier one on the device. */
  tag?: string;
  /** Reminders persist until acknowledged; social events should not. */
  requireInteraction?: boolean;
}

export const tags = {
  friend: (actorId: string) => `friend-${actorId}`,
  group: (groupId: string) => `group-${groupId}`,
  expense: (groupId: string) => `expense-${groupId}`,
  reminder: (reminderId: string) => `reminder-${reminderId}`,
  task: (taskId: string) => `task-${taskId}`,
};

export const paths = {
  people: '/people',
  reminders: '/reminders',
  tasks: '/tasks',
  expenses: '/expenses',
  group: (groupId: string) => `/groups/${groupId}`,
};

export function friendAdded(recipientId: string, actorId: string, actorName: string): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.FRIEND_ADDED,
    title: 'New friend',
    body: `${actorName} added you as a friend.`,
    url: paths.people,
    actorId,
    tag: tags.friend(actorId),
    requireInteraction: false,
  };
}

export function groupMemberAdded(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.GROUP_MEMBER_ADDED,
    title: `Added to ${groupName}`,
    body: `${actorName} added you to ${groupName}.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    tag: tags.group(groupId),
    requireInteraction: false,
  };
}

export function groupMemberRemoved(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.GROUP_MEMBER_REMOVED,
    title: `Removed from ${groupName}`,
    body: `${actorName} removed you from ${groupName}.`,
    // The group is no longer readable by this person, so send them somewhere
    // that still resolves.
    url: paths.expenses,
    actorId,
    groupId,
    tag: tags.group(groupId),
    requireInteraction: false,
  };
}

export function groupRoleChanged(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
  becameOwner: boolean,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.GROUP_ROLE_CHANGED,
    title: becameOwner
      ? `You are now an owner of ${groupName}`
      : `Your role in ${groupName} changed`,
    body: becameOwner
      ? `${actorName} made you an owner.`
      : `${actorName} changed your role to member.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    data: { becameOwner },
    tag: tags.group(groupId),
    requireInteraction: false,
  };
}

export function groupDeleted(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.GROUP_DELETED,
    title: `${groupName} was deleted`,
    body: `${actorName} deleted the group and its expenses.`,
    url: paths.expenses,
    actorId,
    groupId,
    tag: tags.group(groupId),
    requireInteraction: false,
  };
}

export function expenseAdded(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
  expenseId: string,
  expenseTitle: string,
  formattedShare: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.EXPENSE_ADDED,
    title: `New expense in ${groupName}`,
    body: `${actorName} added ${expenseTitle} — your share is ${formattedShare}.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    entityId: expenseId,
    data: { expenseTitle },
    tag: tags.expense(groupId),
    requireInteraction: false,
  };
}

export function expenseUpdated(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  expenseId: string,
  expenseTitle: string,
  formattedShare: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.EXPENSE_UPDATED,
    title: 'Expense updated',
    body: `${actorName} changed ${expenseTitle} — your share is now ${formattedShare}.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    entityId: expenseId,
    data: { expenseTitle },
    tag: tags.expense(groupId),
    requireInteraction: false,
  };
}

export function expenseDeleted(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  groupName: string,
  expenseId: string,
  expenseTitle: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.EXPENSE_DELETED,
    title: 'Expense removed',
    body: `${actorName} deleted ${expenseTitle} from ${groupName}.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    entityId: expenseId,
    data: { expenseTitle },
    tag: tags.expense(groupId),
    requireInteraction: false,
  };
}

export function settlementRecorded(
  recipientId: string,
  actorId: string,
  actorName: string,
  groupId: string,
  settlementId: string,
  formattedAmount: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.SETTLEMENT_RECORDED,
    title: 'Payment recorded',
    body: `${actorName} marked ${formattedAmount} as settled with you.`,
    url: paths.group(groupId),
    actorId,
    groupId,
    entityId: settlementId,
    tag: tags.group(groupId),
    requireInteraction: false,
  };
}

export function reminderLead(
  recipientId: string,
  reminderId: string,
  reminderTitle: string,
  offsetMinutes: number,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.REMINDER_LEAD,
    title: reminderTitle,
    body: `Due in ${offsetMinutes} minutes.`,
    url: paths.reminders,
    entityId: reminderId,
    tag: tags.reminder(reminderId),
    // Reminders are meant to persist until acknowledged.
    requireInteraction: true,
  };
}

export function reminderDue(
  recipientId: string,
  reminderId: string,
  reminderTitle: string,
): NotificationInput {
  return {
    userId: recipientId,
    type: NotificationType.REMINDER_DUE,
    title: reminderTitle,
    body: 'Reminder due now.',
    url: paths.reminders,
    entityId: reminderId,
    tag: tags.reminder(reminderId),
    requireInteraction: true,
  };
}
