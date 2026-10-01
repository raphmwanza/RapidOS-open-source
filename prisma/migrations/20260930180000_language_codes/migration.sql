-- Language columns hold any code from the locale registry (lib/i18n/locales.ts).
-- Widened from VARCHAR(2) so 3-letter codes (e.g. "fil") or regional variants
-- ("pt-BR") can be registered later. Validation happens in the application;
-- there is no enum or CHECK constraint to migrate.
ALTER TABLE "companies" ALTER COLUMN "bot_language" TYPE VARCHAR(10);
ALTER TABLE "companies" ALTER COLUMN "ui_language" TYPE VARCHAR(10);
ALTER TABLE "admins" ALTER COLUMN "ui_language" TYPE VARCHAR(10);
