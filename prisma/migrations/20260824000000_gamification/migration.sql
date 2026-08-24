-- CreateEnum
CREATE TYPE "CreatedVia" AS ENUM ('MANUAL', 'VOICE', 'IMPORT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MissionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "MissionType" AS ENUM ('EXPENSE_COUNT', 'EXPENSE_CATEGORY_COUNT', 'EXPENSE_DAY_COUNT', 'TASK_CREATE_COUNT', 'TASK_CREATE_VOICE_COUNT', 'TASK_COMPLETE_COUNT', 'REMINDER_CREATE_COUNT', 'REMINDER_CREATE_VOICE_COUNT');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'MISSION_COMPLETED';
ALTER TYPE "NotificationType" ADD VALUE 'LEVEL_UP';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentLevel" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "totalXp" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedAt" TIMESTAMP(3),
ADD COLUMN     "createdVia" "CreatedVia" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "createdVia" "CreatedVia" NOT NULL DEFAULT 'MANUAL';

-- AlterTable
ALTER TABLE "Expense" ADD COLUMN     "createdVia" "CreatedVia" NOT NULL DEFAULT 'MANUAL';

-- CreateTable
CREATE TABLE "UserMission" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "MissionType" NOT NULL,
    "target" INTEGER NOT NULL,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "status" "MissionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserMission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "UserMission_userId_status_idx" ON "UserMission"("userId", "status");

-- CreateIndex
CREATE INDEX "UserMission_expiresAt_idx" ON "UserMission"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserMission_userId_type_key" ON "UserMission"("userId", "type");

-- AddForeignKey
ALTER TABLE "UserMission" ADD CONSTRAINT "UserMission_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

