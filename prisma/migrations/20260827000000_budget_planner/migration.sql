-- CreateEnum
CREATE TYPE "PlanItemSource" AS ENUM ('RECURRING', 'CATEGORY');

-- CreateTable
CREATE TABLE "BudgetPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "monthlyIncome" DECIMAL(12,2) NOT NULL,
    "savingsTarget" DECIMAL(12,2),
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BudgetPlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "source" "PlanItemSource" NOT NULL,
    "recurringId" TEXT,
    "category" TEXT,
    "included" BOOLEAN NOT NULL DEFAULT true,
    "amountOverride" DECIMAL(12,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BudgetPlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BudgetPlan_userId_archivedAt_idx" ON "BudgetPlan"("userId", "archivedAt");

-- CreateIndex
CREATE INDEX "BudgetPlanItem_planId_idx" ON "BudgetPlanItem"("planId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlanItem_planId_recurringId_key" ON "BudgetPlanItem"("planId", "recurringId");

-- CreateIndex
CREATE UNIQUE INDEX "BudgetPlanItem_planId_category_key" ON "BudgetPlanItem"("planId", "category");

-- AddForeignKey
ALTER TABLE "BudgetPlan" ADD CONSTRAINT "BudgetPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BudgetPlanItem" ADD CONSTRAINT "BudgetPlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BudgetPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- One live plan per user. Partial, so archived plans can pile up - that history
-- is the point of archiving rather than editing.
CREATE UNIQUE INDEX "BudgetPlan_active_user_key"
  ON "BudgetPlan" ("userId")
  WHERE "archivedAt" IS NULL;
