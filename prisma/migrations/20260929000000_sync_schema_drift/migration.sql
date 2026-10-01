-- Brings the database in line with prisma/schema.prisma (columns that were
-- added to the schema without a migration). Idempotent for databases where
-- these columns were already created out of band.
-- AlterTable
ALTER TABLE "auto_claim_data" ALTER COLUMN "policyNumber" DROP NOT NULL,
ALTER COLUMN "address" DROP NOT NULL,
ALTER COLUMN "licenseNumber" DROP NOT NULL,
ALTER COLUMN "vehicleMakeModel" DROP NOT NULL,
ALTER COLUMN "vehicleYear" DROP NOT NULL,
ALTER COLUMN "vehicleRegistration" DROP NOT NULL,
ALTER COLUMN "vehicleVin" DROP NOT NULL,
ALTER COLUMN "incidentLocation" DROP NOT NULL,
ALTER COLUMN "policeContacted" SET DEFAULT 'false',
ALTER COLUMN "policeContacted" SET DATA TYPE TEXT USING "policeContacted"::text,
ALTER COLUMN "damageDescription" DROP NOT NULL,
ALTER COLUMN "estimatedRepairCost" SET DATA TYPE TEXT USING "estimatedRepairCost"::text,
ALTER COLUMN "injuriesOccurred" SET DEFAULT 'false',
ALTER COLUMN "injuriesOccurred" SET DATA TYPE TEXT USING "injuriesOccurred"::text,
ALTER COLUMN "medicalTreatmentRequired" SET DEFAULT 'false',
ALTER COLUMN "medicalTreatmentRequired" SET DATA TYPE TEXT USING "medicalTreatmentRequired"::text;

-- AlterTable
ALTER TABLE "claims" ALTER COLUMN "incidentDate" DROP NOT NULL,
ALTER COLUMN "description" DROP NOT NULL;

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN IF NOT EXISTS "mode" VARCHAR(30) NOT NULL DEFAULT 'general',
ADD COLUMN IF NOT EXISTS "mode_set_at" TIMESTAMPTZ(6);

-- AlterTable
ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "address" TEXT,
ADD COLUMN IF NOT EXISTS "birth_date" DATE,
ADD COLUMN IF NOT EXISTS "license_number" TEXT,
ADD COLUMN IF NOT EXISTS "policy_number" TEXT;

-- AlterTable
ALTER TABLE "settings" ADD COLUMN IF NOT EXISTS "documentContent" TEXT,
ADD COLUMN IF NOT EXISTS "document_content" TEXT;
