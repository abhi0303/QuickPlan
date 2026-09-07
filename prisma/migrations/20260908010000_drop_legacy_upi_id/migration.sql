-- Restored by hand during an incident: the upiIds migration was applied to
-- production before the matching build was deployed, so the running code was
-- still selecting a column that no longer existed and every login threw. The
-- column went back as a nullable no-op to unblock it.
--
-- Safe to drop again now the upiIds build is live and nothing reads it.
ALTER TABLE "User" DROP COLUMN IF EXISTS "upiId";
