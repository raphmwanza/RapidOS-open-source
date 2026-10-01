-- Public base URL used to build the WhatsApp webhook callback URL shown in Settings.
ALTER TABLE "integration_settings" ADD COLUMN IF NOT EXISTS "public_base_url" TEXT;
