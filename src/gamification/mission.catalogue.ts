import { MissionType } from '@prisma/client';

/**
 * The master list. Definitions live here, not in the database - a user's row
 * stores only the type, target and progress, and the frontend joins back to
 * this catalogue by type for the title, description and icon.
 *
 * Adding a mission means adding an entry here (and a MissionType value); the
 * engine needs no changes as long as the type maps to a counter it already
 * knows how to measure.
 */
export const MISSION_XP = 100;
export const MISSIONS_PER_CYCLE = 3;
export const CYCLE_DURATION_DAYS = 2;

export type MissionArea = 'EXPENSE' | 'TASK' | 'REMINDER';

export interface MissionDefinition {
  type: MissionType;
  target: number;
  xp: number;
  title: string;
  description: string;
  area: MissionArea;
}

export const MISSION_CATALOGUE: readonly MissionDefinition[] = [
  // --- Expenses. No voice variants: expenses have no voice flow. ---
  { type: MissionType.EXPENSE_COUNT, target: 3, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Log Your Spending', description: 'Add 3 expenses' },
  { type: MissionType.EXPENSE_COUNT, target: 5, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Track Your Spending', description: 'Add 5 expenses' },
  { type: MissionType.EXPENSE_COUNT, target: 8, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Keep The Books', description: 'Add 8 expenses' },
  { type: MissionType.EXPENSE_CATEGORY_COUNT, target: 2, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Spread The Net', description: 'Add expenses in 2 different categories' },
  { type: MissionType.EXPENSE_CATEGORY_COUNT, target: 3, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Categorise It', description: 'Add expenses in 3 different categories' },
  { type: MissionType.EXPENSE_DAY_COUNT, target: 2, xp: MISSION_XP, area: 'EXPENSE',
    title: 'Two Day Streak', description: 'Add expenses on 2 different days' },

  // --- Tasks: manual and voice ---
  { type: MissionType.TASK_CREATE_COUNT, target: 3, xp: MISSION_XP, area: 'TASK',
    title: 'Get Things Done', description: 'Create 3 tasks' },
  { type: MissionType.TASK_CREATE_COUNT, target: 5, xp: MISSION_XP, area: 'TASK',
    title: 'Plan Ahead', description: 'Create 5 tasks' },
  { type: MissionType.TASK_CREATE_VOICE_COUNT, target: 2, xp: MISSION_XP, area: 'TASK',
    title: 'Talk To Your Assistant', description: 'Create 2 tasks using voice' },
  { type: MissionType.TASK_CREATE_VOICE_COUNT, target: 3, xp: MISSION_XP, area: 'TASK',
    title: 'Say It Out Loud', description: 'Create 3 tasks using voice' },
  { type: MissionType.TASK_COMPLETE_COUNT, target: 3, xp: MISSION_XP, area: 'TASK',
    title: 'Clear The Board', description: 'Complete 3 tasks' },
  { type: MissionType.TASK_COMPLETE_COUNT, target: 5, xp: MISSION_XP, area: 'TASK',
    title: 'Finish Strong', description: 'Complete 5 tasks' },

  // --- Reminders: manual and voice ---
  { type: MissionType.REMINDER_CREATE_COUNT, target: 2, xp: MISSION_XP, area: 'REMINDER',
    title: 'Never Forget', description: 'Create 2 reminders' },
  { type: MissionType.REMINDER_CREATE_COUNT, target: 3, xp: MISSION_XP, area: 'REMINDER',
    title: 'Stay On Track', description: 'Create 3 reminders' },
  { type: MissionType.REMINDER_CREATE_VOICE_COUNT, target: 2, xp: MISSION_XP, area: 'REMINDER',
    title: 'Just Ask', description: 'Create 2 reminders using voice' },
  { type: MissionType.REMINDER_CREATE_VOICE_COUNT, target: 3, xp: MISSION_XP, area: 'REMINDER',
    title: 'Hands Free', description: 'Create 3 reminders using voice' },
];

const BY_TYPE = new Map<MissionType, MissionDefinition[]>();

for (const definition of MISSION_CATALOGUE) {
  const bucket = BY_TYPE.get(definition.type) ?? [];
  bucket.push(definition);
  BY_TYPE.set(definition.type, bucket);
}

export function definitionsFor(type: MissionType): MissionDefinition[] {
  return BY_TYPE.get(type) ?? [];
}

/** Exposed so the frontend can cache the catalogue and resolve titles offline. */
export function catalogue() {
  return MISSION_CATALOGUE.map((d) => ({ ...d }));
}
