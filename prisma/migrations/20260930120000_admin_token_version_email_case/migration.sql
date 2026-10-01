-- 1) Session revocation: every access/refresh token carries the admin's token_version
--    ("tv" claim). Password reset, deactivation and "sign out everywhere" increment it,
--    so older tokens are rejected on their next request.
ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;

-- 2) Case-insensitive emails. Stop (and change nothing) if two accounts differ only by
--    case/whitespace; those must be merged or renamed by hand first.
DO $$
DECLARE
  collisions TEXT;
BEGIN
  SELECT string_agg(normalized || ' (' || n || ' accounts)', ', ')
    INTO collisions
    FROM (
      SELECT lower(btrim(email)) AS normalized, count(*) AS n
        FROM "admins"
       GROUP BY lower(btrim(email))
      HAVING count(*) > 1
    ) dupes;
  IF collisions IS NOT NULL THEN
    RAISE EXCEPTION 'Cannot lowercase admin emails, these collide: %', collisions;
  END IF;
END $$;

UPDATE "admins" SET "email" = lower(btrim("email")) WHERE "email" <> lower(btrim("email"));

-- Emails are stored lowercased and trimmed, so the existing unique index on "email"
-- is effectively case-insensitive. The CHECK keeps it that way for every writer.
ALTER TABLE "admins" DROP CONSTRAINT IF EXISTS "admins_email_lowercase_check";
ALTER TABLE "admins" ADD CONSTRAINT "admins_email_lowercase_check" CHECK ("email" = lower(btrim("email")));
