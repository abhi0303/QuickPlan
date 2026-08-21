-- AlterTable
ALTER TABLE "Reminder" ADD COLUMN     "sentDueAt" TIMESTAMP(3),
ADD COLUMN     "sentLeadAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "PushSubscription" ADD COLUMN     "failureCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "lastUsedAt" TIMESTAMP(3),
ADD COLUMN     "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "Reminder_userId_idx" ON "Reminder"("userId");

-- CreateIndex
CREATE INDEX "Reminder_status_dueAt_idx" ON "Reminder"("status", "dueAt");

-- CreateIndex
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");


-- Reminder.create used to store dueAt already reduced by offsetMinutes, so the
-- lead-in time was saved in place of the actual due time. Now that both alerts
-- are derived from dueAt, restore the real value on existing rows. Rows with no
-- offset are unaffected.
UPDATE "Reminder"
SET "dueAt" = "dueAt" + make_interval(mins => "offsetMinutes")
WHERE "offsetMinutes" > 0;
