-- Initialize database with extensions and updated schema
-- This file matches the current Prisma schema exactly-generated using prisma migrate diff

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'AGENT', 'MODERATOR'); 
-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant', 'agent', 'system');     
-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'LOGIN', 'LOGOUT', 'EXPORT', 'IMPORT');                                                        
-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('NEW', 'ONGOING', 'APPROVED', 'REJECTED', 'COMPLETED');                                                                      
-- CreateEnum
CREATE TYPE "ClaimCategory" AS ENUM ('AUTO', 'TRAVEL', 'FIRE', 'TRANSPORT', 'CONSTRUCTION', 'HOME', 'HEALTH', 'LIFE', 'BUSINESS', 'OTHER');                     
-- CreateEnum
CREATE TYPE "FeedbackRating" AS ENUM ('VERY_POOR', 'POOR', 'AVERAGE', 'GOOD', 'EXCELLENT');                                                                     
-- CreateEnum
CREATE TYPE "SettingType" AS ENUM ('DOCUMENT', 'TEXT', 'BOOLEAN');

-- CreateTable
CREATE TABLE "companies" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "schema" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

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
    CONSTRAINT "integration_settings_company_id_key" UNIQUE ("company_id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" VARCHAR(20) DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    "created_by_id" UUID,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "id" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "canViewClaims" BOOLEAN NOT NULL DEFAULT true,
    "canCreateClaims" BOOLEAN NOT NULL DEFAULT true,
    "canEditClaims" BOOLEAN NOT NULL DEFAULT true,
    "canApproveClaims" BOOLEAN NOT NULL DEFAULT false,
    "canRejectClaims" BOOLEAN NOT NULL DEFAULT false,
    "canDeleteClaims" BOOLEAN NOT NULL DEFAULT false,
    "canViewCustomers" BOOLEAN NOT NULL DEFAULT true,
    "canEditCustomers" BOOLEAN NOT NULL DEFAULT true,
    "canDeleteCustomers" BOOLEAN NOT NULL DEFAULT false,
    "canCreateAdmins" BOOLEAN NOT NULL DEFAULT false,
    "canEditAdmins" BOOLEAN NOT NULL DEFAULT false,
    "canDeleteAdmins" BOOLEAN NOT NULL DEFAULT false,
    "canCreateBills" BOOLEAN NOT NULL DEFAULT false,
    "canProcessRefunds" BOOLEAN NOT NULL DEFAULT false,
    "canViewFinancials" BOOLEAN NOT NULL DEFAULT false,
    "canViewAnalytics" BOOLEAN NOT NULL DEFAULT true,
    "canExportData" BOOLEAN NOT NULL DEFAULT false,
    "canManageSettings" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "first_name" TEXT,
    "last_name" TEXT,
    "email" TEXT,
    "policy_number" TEXT,
    "address" TEXT,
    "birth_date" DATE,
    "license_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "title" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "is_escalated" BOOLEAN NOT NULL DEFAULT false,
    "is_bot_paused" BOOLEAN NOT NULL DEFAULT false,
    "mode" VARCHAR(30) NOT NULL DEFAULT 'general',
    "mode_set_at" TIMESTAMPTZ(6),
    "paused_by" UUID,
    "paused_at" TIMESTAMP(3),
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "company_id" UUID NOT NULL,
    "customer_id" UUID NOT NULL,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "role" VARCHAR(20),
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "conversation_id" UUID NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_messages" (
    "id" UUID NOT NULL,
    "whatsapp_message_id" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "processed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chatbot_configs" (
    "id" UUID NOT NULL,
    "welcomeMessage" TEXT NOT NULL DEFAULT 'Hello! How can I help you today?',  
    "maxTokens" INTEGER NOT NULL DEFAULT 150,
    "temperature" DECIMAL DEFAULT 0.7,
    "model" TEXT NOT NULL DEFAULT 'gpt-3.5-turbo',
    "systemPrompt" TEXT NOT NULL DEFAULT 'You are a helpful insurance assistant.',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "companyId" UUID NOT NULL,
    "welcome_message" TEXT DEFAULT 'Hello! How can I help you today?',
    "max_tokens" BIGINT DEFAULT 150,
    "system_prompt" TEXT DEFAULT 'You are a helpful insurance assistant.',      
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),

    CONSTRAINT "chatbot_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "isRevoked" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(6),
    "is_revoked" BOOLEAN DEFAULT false,
    "created_at" TIMESTAMPTZ(6),
    "admin_id" UUID,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "action" TEXT,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "adminId" UUID NOT NULL,
    "resource_id" TEXT,
    "old_values" JSONB,
    "new_values" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6),
    "admin_id" UUID,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims" (
    "id" UUID NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "type" "ClaimCategory" NOT NULL DEFAULT 'AUTO',
    "status" "ClaimStatus" NOT NULL DEFAULT 'NEW',
    "customerId" UUID NOT NULL,
    "incidentDate" TIMESTAMP(3),
    "incidentTime" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "botNotes" TEXT,
    "estimatedAmount" DECIMAL(10,2),
    "approvedAmount" DECIMAL(10,2),
    "pdfPath" TEXT,
    "assignedAdminId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "companyId" UUID NOT NULL,

    CONSTRAINT "claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auto_claim_data" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "policyNumber" TEXT,
    "insuredFullName" TEXT NOT NULL,
    "phoneNumber" TEXT NOT NULL,
    "address" TEXT,
    "email" TEXT,
    "birthDate" TIMESTAMP(3),
    "licenseNumber" TEXT,
    "vehicleMakeModel" TEXT,
    "vehicleYear" INTEGER,
    "vehicleRegistration" TEXT,
    "vehicleVin" TEXT,
    "incidentLocation" TEXT,
    "roadType" TEXT,
    "otherDriverName" TEXT,
    "otherDriverPhone" TEXT,
    "otherInsuranceCompany" TEXT,
    "otherPolicyNumber" TEXT,
    "otherVehicleRegistration" TEXT,
    "witnessName" TEXT,
    "witnessPhone" TEXT,
    "policeContacted" TEXT NOT NULL DEFAULT 'false',
    "policeReportNumber" TEXT,
    "damageDescription" TEXT,
    "estimatedRepairCost" TEXT,
    "injuriesOccurred" TEXT NOT NULL DEFAULT 'false',
    "injuryDescription" TEXT,
    "medicalTreatmentRequired" TEXT NOT NULL DEFAULT 'false',
    "additionalNotes" TEXT,
    "totalPhotosUploaded" INTEGER NOT NULL DEFAULT 0,
    "damagePhotos" TEXT[],
    "vehiclePhotos" TEXT[],
    "policeReportDocument" TEXT[],
    "insuranceCardPhoto" TEXT[],
    "driverLicensePhoto" TEXT[],
    "additionalDocuments" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "auto_claim_data_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_documents" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fileName" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedBy" TEXT,
    "base64Data" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_status_history" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "fromStatus" "ClaimStatus",
    "toStatus" "ClaimStatus" NOT NULL,
    "reason" TEXT,
    "changedBy" UUID NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_status_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_notes" (
    "id" UUID NOT NULL,
    "claimId" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "isInternal" BOOLEAN NOT NULL DEFAULT false,
    "authorId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_notes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "analytics" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "totalConversations" INTEGER NOT NULL DEFAULT 0,
    "botResolvedConversations" INTEGER NOT NULL DEFAULT 0,
    "humanEscalations" INTEGER NOT NULL DEFAULT 0,
    "avgResponseTime" DOUBLE PRECISION,
    "resolutionRate" DOUBLE PRECISION,
    "escalationRate" DOUBLE PRECISION,
    "totalClaims" INTEGER NOT NULL DEFAULT 0,
    "newClaims" INTEGER NOT NULL DEFAULT 0,
    "approvedClaims" INTEGER NOT NULL DEFAULT 0,
    "rejectedClaims" INTEGER NOT NULL DEFAULT 0,
    "completedClaims" INTEGER NOT NULL DEFAULT 0,
    "avgClaimProcessingTime" DOUBLE PRECISION,
    "avgSatisfactionRating" DOUBLE PRECISION,
    "totalFeedbacks" INTEGER NOT NULL DEFAULT 0,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "analytics_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedbacks" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "conversationId" UUID,
    "rating" "FeedbackRating" NOT NULL,
    "comment" TEXT,
    "category" TEXT,
    "wasEscalated" BOOLEAN NOT NULL DEFAULT false,
    "resolvedByBot" BOOLEAN NOT NULL DEFAULT true,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedbacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "type" VARCHAR(20) NOT NULL DEFAULT 'DOCUMENT',
    "textValue" TEXT,
    "documentUrl" TEXT,
    "documentContent" TEXT,
    "boolValue" BOOLEAN,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "companyId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" UUID,
    "updatedBy" UUID,
    "text_value" TEXT,
    "document_url" TEXT,
    "document_content" TEXT,
    "bool_value" BOOLEAN,
    "is_active" BOOLEAN DEFAULT true,
    "created_at" TIMESTAMPTZ(6),
    "updated_at" TIMESTAMPTZ(6),
    "created_by" UUID,
    "updated_by" UUID,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_types" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "type_name" VARCHAR(50) NOT NULL,
    "display_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "detection_keywords" TEXT[],
    "confidence_threshold" DECIMAL(3,2) NOT NULL DEFAULT 0.7,
    "requires_confirmation" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_types_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_fields" (
    "id" UUID NOT NULL,
    "claim_type_id" UUID NOT NULL,
    "field_name" VARCHAR(100) NOT NULL,
    "display_name" VARCHAR(200) NOT NULL,
    "field_type" VARCHAR(50) NOT NULL,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "is_sensitive" BOOLEAN NOT NULL DEFAULT false,
    "validation_rules" JSONB,
    "default_value" TEXT,
    "help_text" TEXT,
    "placeholder_text" TEXT,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "extraction_prompt" TEXT,
    "confirmation_required" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_detection_prompts" (
    "id" UUID NOT NULL,
    "company_id" UUID NOT NULL,
    "claim_type_id" UUID,
    "prompt_type" VARCHAR(50) NOT NULL,
    "language" VARCHAR(10) NOT NULL DEFAULT 'fr',
    "prompt_template" TEXT NOT NULL,
    "confidence_factors" JSONB,
    "fallback_questions" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_detection_prompts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_detection_results" (
    "id" UUID NOT NULL,
    "conversation_id" UUID NOT NULL,
    "message_id" UUID,
    "detected_claim_type_id" UUID,
    "confidence_score" DECIMAL(4,3),
    "detection_factors" JSONB,
    "user_confirmed" BOOLEAN,
    "user_selected_type_id" UUID,
    "auto_extracted_data" JSONB,
    "final_claim_data" JSONB,
    "processing_status" VARCHAR(50) NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "claim_detection_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dynamic_claim_data" (
    "id" UUID NOT NULL,
    "claim_id" UUID NOT NULL,
    "claim_type_id" UUID NOT NULL,
    "field_data" JSONB NOT NULL,
    "validation_status" JSONB,
    "completion_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0.00,
    "last_updated_field" VARCHAR(100),
    "requires_review" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dynamic_claim_data_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "companies_name_key" ON "companies"("name");

-- CreateIndex
CREATE UNIQUE INDEX "companies_slug_key" ON "companies"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "companies_domain_key" ON "companies"("domain");

-- CreateIndex
CREATE UNIQUE INDEX "companies_schema_key" ON "companies"("schema");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_company_id_idx" ON "admins"("company_id");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "idx_admins_company_id" ON "admins"("company_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permissions_adminId_key" ON "admin_permissions"("adminId");                                                                          
-- CreateIndex
CREATE INDEX "customers_company_id_idx" ON "customers"("company_id");

-- CreateIndex
CREATE INDEX "customers_phone_number_idx" ON "customers"("phone_number");       

-- CreateIndex
CREATE INDEX "idx_customers_company_id" ON "customers"("company_id");

-- CreateIndex
CREATE INDEX "idx_customers_phone_number" ON "customers"("phone_number");       

-- CreateIndex
CREATE UNIQUE INDEX "customers_phone_number_company_id_key" ON "customers"("phone_number", "company_id");                                                       
-- CreateIndex
CREATE INDEX "conversations_company_id_idx" ON "conversations"("company_id");   

-- CreateIndex
CREATE INDEX "conversations_customer_id_idx" ON "conversations"("customer_id"); 

-- CreateIndex
CREATE INDEX "conversations_created_at_idx" ON "conversations"("created_at");   

-- CreateIndex
CREATE INDEX "conversations_is_escalated_idx" ON "conversations"("is_escalated");                                                                               
-- CreateIndex
CREATE INDEX "conversations_is_bot_paused_idx" ON "conversations"("is_bot_paused");                                                                             
-- CreateIndex
CREATE INDEX "idx_conversations_company_id" ON "conversations"("company_id");   

-- CreateIndex
CREATE INDEX "idx_conversations_customer_id" ON "conversations"("customer_id"); 

-- CreateIndex
CREATE INDEX "messages_conversation_id_idx" ON "messages"("conversation_id");   

-- CreateIndex
CREATE INDEX "messages_created_at_idx" ON "messages"("created_at");

-- CreateIndex
CREATE INDEX "idx_messages_conversation_id" ON "messages"("conversation_id");   

-- CreateIndex
CREATE UNIQUE INDEX "processed_messages_whatsapp_message_id_key" ON "processed_messages"("whatsapp_message_id");                                                
-- CreateIndex
CREATE INDEX "processed_messages_whatsapp_message_id_idx" ON "processed_messages"("whatsapp_message_id");                                                       
-- CreateIndex
CREATE INDEX "processed_messages_phone_number_idx" ON "processed_messages"("phone_number");                                                                     
-- CreateIndex
CREATE INDEX "processed_messages_processed_at_idx" ON "processed_messages"("processed_at");                                                                     
-- CreateIndex
CREATE UNIQUE INDEX "chatbot_configs_companyId_key" ON "chatbot_configs"("companyId");                                                                          
-- CreateIndex
CREATE UNIQUE INDEX "idx_refresh_tokens_token" ON "refresh_tokens"("token");    

-- CreateIndex
CREATE INDEX "refresh_tokens_adminId_idx" ON "refresh_tokens"("adminId");       

-- CreateIndex
CREATE INDEX "refresh_tokens_token_idx" ON "refresh_tokens"("token");

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_admin_id" ON "refresh_tokens"("admin_id");     

-- CreateIndex
CREATE INDEX "idx_refresh_tokens_expires_at" ON "refresh_tokens"("expires_at"); 

-- CreateIndex
CREATE INDEX "audit_logs_adminId_idx" ON "audit_logs"("adminId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "idx_audit_logs_admin_id" ON "audit_logs"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "claims_claimNumber_key" ON "claims"("claimNumber");        

-- CreateIndex
CREATE INDEX "claims_companyId_idx" ON "claims"("companyId");

-- CreateIndex
CREATE INDEX "claims_customerId_idx" ON "claims"("customerId");

-- CreateIndex
CREATE INDEX "claims_status_idx" ON "claims"("status");

-- CreateIndex
CREATE INDEX "claims_claimNumber_idx" ON "claims"("claimNumber");

-- CreateIndex
CREATE INDEX "claims_createdAt_idx" ON "claims"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "auto_claim_data_claimId_key" ON "auto_claim_data"("claimId");                                                                              
-- CreateIndex
CREATE INDEX "claim_documents_claimId_idx" ON "claim_documents"("claimId");     

-- CreateIndex
CREATE INDEX "claim_status_history_claimId_idx" ON "claim_status_history"("claimId");                                                                           
-- CreateIndex
CREATE INDEX "claim_status_history_changedAt_idx" ON "claim_status_history"("changedAt");                                                                       
-- CreateIndex
CREATE INDEX "claim_notes_claimId_idx" ON "claim_notes"("claimId");

-- CreateIndex
CREATE INDEX "claim_notes_authorId_idx" ON "claim_notes"("authorId");

-- CreateIndex
CREATE INDEX "claim_notes_createdAt_idx" ON "claim_notes"("createdAt");

-- CreateIndex
CREATE INDEX "analytics_companyId_idx" ON "analytics"("companyId");

-- CreateIndex
CREATE INDEX "analytics_date_idx" ON "analytics"("date");

-- CreateIndex
CREATE UNIQUE INDEX "analytics_date_companyId_key" ON "analytics"("date", "companyId");                                                                         
-- CreateIndex
CREATE INDEX "feedbacks_companyId_idx" ON "feedbacks"("companyId");

-- CreateIndex
CREATE INDEX "feedbacks_rating_idx" ON "feedbacks"("rating");

-- CreateIndex
CREATE INDEX "feedbacks_createdAt_idx" ON "feedbacks"("createdAt");

-- CreateIndex
CREATE INDEX "settings_companyId_idx" ON "settings"("companyId");

-- CreateIndex
CREATE INDEX "settings_type_idx" ON "settings"("type");

-- CreateIndex
CREATE INDEX "settings_isActive_idx" ON "settings"("isActive");

-- CreateIndex
CREATE INDEX "idx_settings_company_id" ON "settings"("companyId");

-- CreateIndex
CREATE INDEX "claim_types_company_id_is_active_idx" ON "claim_types"("company_id", "is_active");                                                                
-- CreateIndex
CREATE UNIQUE INDEX "claim_types_company_id_type_name_key" ON "claim_types"("company_id", "type_name");                                                         
-- CreateIndex
CREATE INDEX "claim_fields_claim_type_id_is_required_idx" ON "claim_fields"("claim_type_id", "is_required");                                                    
-- CreateIndex
CREATE UNIQUE INDEX "claim_fields_claim_type_id_field_name_key" ON "claim_fields"("claim_type_id", "field_name");                                               
-- CreateIndex
CREATE INDEX "claim_detection_prompts_company_id_claim_type_id_prompt_typ_idx" ON "claim_detection_prompts"("company_id", "claim_type_id", "prompt_type");      
-- CreateIndex
CREATE INDEX "claim_detection_results_conversation_id_created_at_idx" ON "claim_detection_results"("conversation_id", "created_at");                            
-- CreateIndex
CREATE UNIQUE INDEX "dynamic_claim_data_claim_id_key" ON "dynamic_claim_data"("claim_id");                                                                      
-- CreateIndex
CREATE INDEX "dynamic_claim_data_claim_id_claim_type_id_idx" ON "dynamic_claim_data"("claim_id", "claim_type_id");                                              
-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;       
-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;   
-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "fk_companies_admins" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;      
-- AddForeignKey
ALTER TABLE "admin_permissions" ADD CONSTRAINT "admin_permissions_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                          
-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE; 
-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "fk_companies_customers" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;
-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                         
-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                       
-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "fk_companies_conversations" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;                                                                        
-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "fk_conversations_messages" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;                                                                     
-- AddForeignKey
ALTER TABLE "chatbot_configs" ADD CONSTRAINT "chatbot_configs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                       
-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "fk_admins_refresh_tokens" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;                                                                              
-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;        
-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "fk_admins_audit_logs" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;      
-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_assignedAdminId_fkey" FOREIGN KEY ("assignedAdminId") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;                                                                               
-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;         
-- AddForeignKey
ALTER TABLE "claims" ADD CONSTRAINT "claims_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;       
-- AddForeignKey
ALTER TABLE "auto_claim_data" ADD CONSTRAINT "auto_claim_data_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                              
-- AddForeignKey
ALTER TABLE "claim_documents" ADD CONSTRAINT "claim_documents_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                              
-- AddForeignKey
ALTER TABLE "claim_status_history" ADD CONSTRAINT "claim_status_history_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                    
-- AddForeignKey
ALTER TABLE "claim_notes" ADD CONSTRAINT "claim_notes_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "admins"("id") ON DELETE RESTRICT ON UPDATE CASCADE;   
-- AddForeignKey
ALTER TABLE "claim_notes" ADD CONSTRAINT "claim_notes_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;      
-- AddForeignKey
ALTER TABLE "analytics" ADD CONSTRAINT "analytics_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;   
-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;   
-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;                                                                    
-- AddForeignKey
ALTER TABLE "feedbacks" ADD CONSTRAINT "feedbacks_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE; 
-- AddForeignKey
ALTER TABLE "settings" ADD CONSTRAINT "fk_companies_settings" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;   
-- AddForeignKey
ALTER TABLE "claim_types" ADD CONSTRAINT "claim_types_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                             
-- AddForeignKey
ALTER TABLE "claim_fields" ADD CONSTRAINT "claim_fields_claim_type_id_fkey" FOREIGN KEY ("claim_type_id") REFERENCES "claim_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                   
-- AddForeignKey
ALTER TABLE "claim_detection_prompts" ADD CONSTRAINT "claim_detection_prompts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                     
-- AddForeignKey
ALTER TABLE "claim_detection_prompts" ADD CONSTRAINT "claim_detection_prompts_claim_type_id_fkey" FOREIGN KEY ("claim_type_id") REFERENCES "claim_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                             
-- AddForeignKey
ALTER TABLE "claim_detection_results" ADD CONSTRAINT "claim_detection_results_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                       
-- AddForeignKey
ALTER TABLE "claim_detection_results" ADD CONSTRAINT "claim_detection_results_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;                                                     
-- AddForeignKey
ALTER TABLE "claim_detection_results" ADD CONSTRAINT "claim_detection_results_detected_claim_type_id_fkey" FOREIGN KEY ("detected_claim_type_id") REFERENCES "claim_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;                          
-- AddForeignKey
ALTER TABLE "claim_detection_results" ADD CONSTRAINT "claim_detection_results_user_selected_type_id_fkey" FOREIGN KEY ("user_selected_type_id") REFERENCES "claim_types"("id") ON DELETE SET NULL ON UPDATE CASCADE;                            
-- AddForeignKey
ALTER TABLE "dynamic_claim_data" ADD CONSTRAINT "dynamic_claim_data_claim_id_fkey" FOREIGN KEY ("claim_id") REFERENCES "claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                                      
-- AddForeignKey
ALTER TABLE "dynamic_claim_data" ADD CONSTRAINT "dynamic_claim_data_claim_type_id_fkey" FOREIGN KEY ("claim_type_id") REFERENCES "claim_types"("id") ON DELETE CASCADE ON UPDATE CASCADE;                                                       


-- ============================================================================
-- CREATE COMPANY-SPECIFIC SCHEMAS FOR LEGACY SUPPORT
-- ============================================================================

CREATE SCHEMA IF NOT EXISTS koya_insurance;
CREATE SCHEMA IF NOT EXISTS star_insurance;
CREATE SCHEMA IF NOT EXISTS tenant_template;

-- ============================================================================
-- SET UP ROW LEVEL SECURITY FOR MULTI-TENANCY
-- ============================================================================

ALTER DATABASE rapidos SET row_security = on;

-- ============================================================================
-- CREATE PRISMA MIGRATIONS TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
    "id" VARCHAR(255) NOT NULL,
    "checksum" VARCHAR(64) NOT NULL,
    "finished_at" TIMESTAMP(3),
    "migration_name" VARCHAR(255) NOT NULL,
    "logs" TEXT,
    "rolled_back_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_steps_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "_prisma_migrations_pkey" PRIMARY KEY ("id")
);

