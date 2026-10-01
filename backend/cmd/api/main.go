// Command api is the RapidOS Go API (WhatsApp webhook, AI replies, internal routes).
//
// Copyright (C) 2026 Raph Mwanza <raphmwanza5@gmail.com>
// SPDX-License-Identifier: AGPL-3.0-only
// See LICENSE and NOTICE at the repository root.
package main

import (
	"log"
	"os"
	"rapidos/internal/config"
	"rapidos/internal/db"
	"rapidos/internal/logger"
	"rapidos/internal/models"
	"rapidos/internal/router"
	"rapidos/internal/service"
)

func main() {
	cfg := config.Load()
	logg := logger.New()

	gormDB := db.ConnectPostgres(cfg, logg)
	redisClient := db.ConnectRedis(cfg, logg)

	// Prisma migrations (prisma/migrations, applied by `prisma migrate deploy`)
	// own the database schema. GORM AutoMigrate conflicts with Prisma's
	// constraint names, so it only runs when explicitly requested.
	if os.Getenv("DB_AUTO_MIGRATE") == "true" {
		if err := gormDB.AutoMigrate(&models.Company{}, &models.Admin{}, &models.AdminPermissions{}, &models.Customer{}, &models.Conversation{}, &models.Message{}, &models.ChatbotConfig{}, &models.RefreshToken{}, &models.AuditLog{}, &models.Setting{}, &models.IntegrationSettings{}); err != nil {
			logg.Fatalf("auto migrate failed: %v", err)
		}
	}

	// Initialize database service to be passed to other services
	databaseService := service.NewDatabaseService(gormDB, cfg, logg)

	// Initialize AI conversation service (provider-agnostic LLM)
	semanticKernelService, err := service.NewSemanticKernelService(databaseService, cfg, logg)
	if err != nil {
		logg.Warnf("failed to initialize semantic kernel service: %v", err)
		// Continue without semantic kernel service - handlers will adapt
	}

	r := router.Build(cfg, logg, gormDB, redisClient, databaseService, semanticKernelService)
	logg.Infof("starting api server on :%s", cfg.APIPort)
	if err := r.Run(":" + cfg.APIPort); err != nil {
		log.Fatal(err)
	}
}
