-- Personal expenses: one table, split by scope.
--
-- Existing rows are all GROUP and keep every field they had. ownerId is
-- backfilled from paidById, which is what it means for a group expense, so no
-- data moves and no expense changes hands.

-- CreateEnum
CREATE TYPE "ExpenseScope" AS ENUM ('PERSONAL', 'GROUP');

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "ownerId" TEXT,
ADD COLUMN     "scope" "ExpenseScope" NOT NULL DEFAULT 'GROUP',
ALTER COLUMN "groupId" DROP NOT NULL,
ALTER COLUMN "paidById" DROP NOT NULL,
ALTER COLUMN "splitType" DROP NOT NULL,
ALTER COLUMN "splitType" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "Expense_ownerId_scope_date_idx" ON "Expense"("ownerId", "scope", "date");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill before tightening: every existing expense is a group expense, and
-- its owner is whoever paid.
UPDATE "Expense" SET "ownerId" = "paidById" WHERE "ownerId" IS NULL;
ALTER TABLE "Expense" ALTER COLUMN "ownerId" SET NOT NULL;

-- The constraint is the point of the design. Without it a nullable groupId
-- quietly becomes "sometimes there are shares, sometimes not" a few months from
-- now. A GROUP expense always has a group, a payer and a split; a PERSONAL one
-- has none of the three.
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_scope_shape_check" CHECK (
  ("scope" = 'GROUP'
     AND "groupId" IS NOT NULL
     AND "paidById" IS NOT NULL
     AND "splitType" IS NOT NULL)
  OR
  ("scope" = 'PERSONAL'
     AND "groupId" IS NULL
     AND "paidById" IS NULL
     AND "splitType" IS NULL)
);
