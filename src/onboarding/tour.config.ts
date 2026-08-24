/**
 * The guided tour, held as static config so the copy can change without a
 * frontend release and without storing a single step per user.
 *
 * Bump TOUR_VERSION only when the tour changes materially enough that people
 * who already finished it should see it again. Editing wording does not
 * warrant a bump - it would re-interrupt every existing user.
 */
export const TOUR_VERSION = 1;

export interface TourStep {
  /** Stable key. The frontend maps this to the element it highlights. */
  id: string;
  order: number;
  title: string;
  body: string;
  /** App path to navigate to before showing the step. */
  route: string;
  /** Which part of the product this step is about, for the frontend's own grouping. */
  area: 'INTRO' | 'TASKS' | 'REMINDERS' | 'MONEY' | 'PROGRESS' | 'OUTRO';
}

export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    order: 1,
    title: 'Welcome to QuickPlan',
    body: 'A quick look around — about a minute. You can skip it now and restart it any time from Settings.',
    route: '/',
    area: 'INTRO',
  },
  {
    id: 'tasks',
    order: 2,
    title: 'Tasks',
    body: 'Everything you need to do, in one list. Add a task by typing, or speak it and QuickPlan fills in the details for you.',
    route: '/tasks',
    area: 'TASKS',
  },
  {
    id: 'reminders',
    order: 3,
    title: 'Reminders',
    body: 'Set a time and QuickPlan will nudge you — once before it is due, and again when it is. Alerts reach your phone even with the app closed.',
    route: '/reminders',
    area: 'REMINDERS',
  },
  {
    id: 'money',
    order: 4,
    title: 'Money',
    body: 'Share costs in a group. Add friends, log what each person paid, and QuickPlan works out who owes whom — and the fewest payments that settle it.',
    route: '/money',
    area: 'MONEY',
  },
  {
    id: 'level',
    order: 5,
    title: 'Your journey starts here',
    body: 'You begin at Level 1. Using QuickPlan earns XP, and every level brings a new rank and badge — a hundred of them, all the way to Ultimate Money Master.',
    route: '/gamification',
    area: 'PROGRESS',
  },
  {
    id: 'missions',
    order: 6,
    title: 'Missions',
    body: 'Three short missions at a time, worth 100 XP each. They refresh every two days, so there is always something within reach.',
    route: '/gamification',
    area: 'PROGRESS',
  },
  {
    id: 'finish',
    order: 7,
    title: 'You are all set',
    body: 'That is the tour. Start with a task or your first expense — your first mission is already waiting.',
    route: '/',
    area: 'OUTRO',
  },
];

export const TOTAL_STEPS = TOUR_STEPS.length;
