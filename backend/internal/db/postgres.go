package db

import (
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
)

// ConnectPostgres attempts to connect to the Postgres database with retries
func ConnectPostgres(cfg *config.Config, logg *logger.Logger) *gorm.DB {
	var db *gorm.DB
	var err error
	maxRetries := 10
	retryInterval := 3 * time.Second

	for attempt := 1; attempt <= maxRetries; attempt++ {
		logg.Infof("Attempting to connect to Postgres (attempt %d/%d)...", attempt, maxRetries)

		db, err = gorm.Open(postgres.Open(cfg.DatabaseURL), &gorm.Config{})
		if err == nil {
			logg.Infof("Successfully connected to Postgres on attempt %d", attempt)
			return db
		}

		logg.Warnf("Failed to connect to Postgres (attempt %d/%d): %v", attempt, maxRetries, err)

		if attempt < maxRetries {
			logg.Infof("Retrying in %v...", retryInterval)
			time.Sleep(retryInterval)
			// Increase retry interval for next attempt (exponential backoff)
			retryInterval = time.Duration(float64(retryInterval) * 1.5)
		}
	}

	// If we've exhausted all retries, fail with a helpful message
	logg.Fatalf("failed to initialize database after %d attempts, got error %v", maxRetries, err)
	return nil // This line will never be reached due to Fatalf above, but needed for compilation
}
