-- One person often has a bank handle and a wallet, and whoever owes them may
-- only have an app for one of the two. Order is meaningful: first is preferred.
ALTER TABLE "User" ADD COLUMN "upiIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Carry across anything already set. Nothing is, today, but a migration that
-- only works on an empty column is a trap for whoever runs it next.
UPDATE "User" SET "upiIds" = ARRAY["upiId"] WHERE "upiId" IS NOT NULL AND "upiId" <> '';

ALTER TABLE "User" DROP COLUMN "upiId";
