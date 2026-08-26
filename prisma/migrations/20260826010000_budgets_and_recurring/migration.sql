-- CreateEnum
CREATE TYPE "BudgetPeriod" AS ENUM ('MONTHLY', 'WEEKLY');

-- CreateEnum
CREATE TYPE "BudgetScope" AS ENUM ('PERSONAL', 'ALL');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('ON_TRACK', 'WARNING', 'EXCEEDED');

-- CreateEnum
CREATE TYPE "RecurringCadence" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'BUDGET_WARNING';
ALTER TYPE "NotificationType" ADD VALUE 'BUDGET_EXCEEDED';

-- CreateTable
CREATE TABLE "Budget" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT,
    "amount" DECIMAL(12,2) NOT NULL,
    "period" "BudgetPeriod" NOT NULL DEFAULT 'MONTHLY',
    "scope" "BudgetScope" NOT NULL DEFAULT 'PERSONAL',
    "startsOn" DATE NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Budget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPeriodAlert" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "periodKey" TEXT NOT NULL,
    "lastStatus" "BudgetStatus" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPeriodAlert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecurringExpense" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scope" "ExpenseScope" NOT NULL DEFAULT 'PERSONAL',
    "groupId" TEXT,
    "title" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "category" TEXT,
    "cadence" "RecurringCadence" NOT NULL,
    "dayOfMonth" INTEGER,
    "weekday" INTEGER,
    "nextRunAt" TIMESTAMP(3) NOT NULL,
    "lastRunKey" TEXT,
    "endsOn" DATE,
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecurringExpense_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Budget_userId_archivedAt_idx" ON "Budget"("userId", "archivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPeriodAlert_budgetId_periodKey_key" ON "BudgetPeriodAlert"("budgetId", "periodKey");

-- CreateIndex
CREATE INDEX "RecurringExpense_nextRunAt_idx" ON "RecurringExpense"("nextRunAt");

-- CreateIndex
CREATE INDEX "RecurringExpense_userId_idx" ON "RecurringExpense"("userId");

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPeriodAlert" ADD CONSTRAINT "BudgetPeriodAlert_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "Budget"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Prisma cannot express a partial unique index, and a plain one would be wrong:
-- archived budgets must be allowed to pile up for the same category, otherwise
-- you could never replace a budget you had archived. Only the live ones are
-- unique. COALESCE because NULL is the overall budget, and NULL never equals
-- NULL in a unique index.
CREATE UNIQUE INDEX "Budget_active_category_period_key"
  ON "Budget" ("userId", COALESCE("category", ''), "period")
  WHERE "archivedAt" IS NULL;
