ALTER TABLE "User" ADD COLUMN "termsVersion"    TEXT;
ALTER TABLE "User" ADD COLUMN "termsAcceptedAt" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN "deletedAt"       TIMESTAMP(3);

-- Backfill so no query has to special-case a null, but deliberately NOT as
-- consent: these people never saw a policy, because there wasn't one. Recording
-- them as having agreed to something that did not exist would be worthless the
-- one time it mattered. 'legacy' is older than every published version, so each
-- of them is asked once, and that record is true.
UPDATE "User"
   SET "termsVersion"    = 'legacy',
       "termsAcceptedAt" = "createdAt"
 WHERE "termsVersion" IS NULL;
