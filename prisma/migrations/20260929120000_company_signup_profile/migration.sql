-- Company profile captured by the signup wizard, plus dashboard UI language
-- (company default and per-admin override).
ALTER TABLE "companies"
  ADD COLUMN IF NOT EXISTS "ui_language" VARCHAR(2) NOT NULL DEFAULT 'en',
  ADD COLUMN IF NOT EXISTS "contact_email" TEXT,
  ADD COLUMN IF NOT EXISTS "contact_phone" TEXT,
  ADD COLUMN IF NOT EXISTS "country" TEXT,
  ADD COLUMN IF NOT EXISTS "city" TEXT,
  ADD COLUMN IF NOT EXISTS "address" TEXT;

-- Existing tenants keep a dashboard language that matches their bot.
UPDATE "companies" SET "ui_language" = "bot_language" WHERE "bot_language" IN ('en', 'fr');

ALTER TABLE "admins" ADD COLUMN IF NOT EXISTS "ui_language" VARCHAR(2);
