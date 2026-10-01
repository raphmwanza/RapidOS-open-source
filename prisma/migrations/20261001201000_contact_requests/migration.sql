-- Submissions of the public /contact form. No e-mail is sent; the operator
-- panel lists them.
CREATE TABLE IF NOT EXISTS "contact_requests" (
  "id"                UUID         NOT NULL DEFAULT gen_random_uuid(),
  "full_name"         VARCHAR(120) NOT NULL,
  "work_email"        VARCHAR(254) NOT NULL,
  "phone"             VARCHAR(40)  NOT NULL,
  "company_name"      VARCHAR(160) NOT NULL,
  "country"           VARCHAR(80)  NOT NULL,
  "company_type"      VARCHAR(20)  NOT NULL,
  "employees"         VARCHAR(20)  NOT NULL,
  "insured_customers" VARCHAR(20)  NOT NULL,
  "claims_per_month"  VARCHAR(20)  NOT NULL,
  "coverages"         TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "deployment"        VARCHAR(20)  NOT NULL,
  "desired_start"     DATE,
  "heard_from"        VARCHAR(200),
  "message"           VARCHAR(5000) NOT NULL,
  "ip_address"        VARCHAR(64),
  "user_agent"        VARCHAR(300),
  "handled_at"        TIMESTAMPTZ(6),
  "created_at"        TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "contact_requests_created_at_idx" ON "contact_requests" ("created_at");
