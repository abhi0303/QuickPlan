-- The VPA other group members are shown when they owe this person money.
-- Nullable: publishing one is optional, and null means the pay button is
-- simply not offered.
ALTER TABLE "User" ADD COLUMN "upiId" TEXT;
