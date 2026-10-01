package db

import (
	"context"
	"rapidos/internal/config"
	"rapidos/internal/logger"
	"time"

	"github.com/redis/go-redis/v9"
)

// ConnectRedis attempts to connect to Redis with retries
func ConnectRedis(cfg *config.Config, logg *logger.Logger) *redis.Client {
	opt, err := redis.ParseURL(cfg.RedisURL)
	if err != nil {
		logg.Fatalf("invalid redis url: %v", err)
	}

	rdb := redis.NewClient(opt)
	maxRetries := 10
	retryInterval := 3 * time.Second

	for attempt := 1; attempt <= maxRetries; attempt++ {
		logg.Infof("Attempting to connect to Redis (attempt %d/%d)...", attempt, maxRetries)

		ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		err := rdb.Ping(ctx).Err()
		cancel()

		if err == nil {
			logg.Infof("Successfully connected to Redis on attempt %d", attempt)
			return rdb
		}

		logg.Warnf("Failed to connect to Redis (attempt %d/%d): %v", attempt, maxRetries, err)

		if attempt < maxRetries {
			logg.Infof("Retrying in %v...", retryInterval)
			time.Sleep(retryInterval)
			// Increase retry interval for next attempt (exponential backoff)
			retryInterval = time.Duration(float64(retryInterval) * 1.5)
		}
	}

	// If we've exhausted all retries, fail with a helpful message
	logg.Fatalf("failed to connect to Redis after %d attempts", maxRetries)
	return nil // This line will never be reached due to Fatalf above, but needed for compilation
}
