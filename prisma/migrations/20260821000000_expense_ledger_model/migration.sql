-- Expense ledger model: enums, exact money, explicit payer, filter indexes.
--
-- NOTE: type/status are dropped and recreated as enums, and Person.nameKey is
-- added NOT NULL without a default. Authored and applied against empty
-- Expense/ExpenseParticipant/Person tables. Backfill first if replaying
-- against populated ones.

-- CreateEnum
CREATE TYPE "ExpenseType" AS ENUM ('IOU_PAYABLE', 'IOU_RECEIVABLE', 'SPLIT_EXPENSE');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('PENDING', 'SETTLED');

-- CreateEnum
CREATE TYPE "ParticipantStatus" AS ENUM ('PENDING', 'PAID');

-- AlterTable
ALTER TABLE "Person" ADD COLUMN     "nameKey" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "paidByMe" BOOLEAN NOT NULL DEFAULT true,
ALTER COLUMN "totalAmount" SET DATA TYPE DECIMAL(12,2),
DROP COLUMN "type",
ADD COLUMN     "type" "ExpenseType" NOT NULL,
DROP COLUMN "status",
ADD COLUMN     "status" "ExpenseStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "ExpenseParticipant" ALTER COLUMN "shareAmount" SET DATA TYPE DECIMAL(12,2),
DROP COLUMN "status",
ADD COLUMN     "status" "ParticipantStatus" NOT NULL DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Person_userId_idx" ON "Person"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_userId_nameKey_key" ON "Person"("userId", "nameKey");

-- CreateIndex
CREATE INDEX "Expense_userId_status_idx" ON "Expense"("userId", "status");

-- CreateIndex
CREATE INDEX "Expense_userId_type_idx" ON "Expense"("userId", "type");

-- CreateIndex
CREATE INDEX "Expense_userId_createdAt_idx" ON "Expense"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Expense_paidById_idx" ON "Expense"("paidById");

-- CreateIndex
CREATE INDEX "ExpenseParticipant_expenseId_idx" ON "ExpenseParticipant"("expenseId");

-- CreateIndex
CREATE INDEX "ExpenseParticipant_personId_status_idx" ON "ExpenseParticipant"("personId", "status");

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_paidById_fkey" FOREIGN KEY ("paidById") REFERENCES "Person"("id") ON DELETE SET NULL ON UPDATE CASCADE;

