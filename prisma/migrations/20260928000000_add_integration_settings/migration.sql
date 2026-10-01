CREATE TABLE "integration_settings" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "company_id" UUID NOT NULL,
  "whatsapp_display_number" TEXT,
  "whatsapp_phone_number_id" TEXT,
  "whatsapp_access_token_cipher" TEXT,
  "meta_app_secret_cipher" TEXT,
  "webhook_verify_token_cipher" TEXT,
  "whatsapp_business_account_id" TEXT,
  "llm_provider" VARCHAR(20),
  "llm_api_key_cipher" TEXT,
  "llm_model" TEXT,
  "llm_base_url" TEXT,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_settings_company_id_key" UNIQUE ("company_id"),
  CONSTRAINT "integration_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
