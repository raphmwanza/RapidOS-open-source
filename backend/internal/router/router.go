package router

import (
	"rapidos/internal/config"
	"rapidos/internal/handlers"
	"rapidos/internal/logger"
	"rapidos/internal/middleware"
	"rapidos/internal/service"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"gorm.io/gorm"
)

func Build(cfg *config.Config, logg *logger.Logger, db *gorm.DB, rdb *redis.Client,
	dbService *service.DatabaseService, skService *service.SemanticKernelService) *gin.Engine {
	r := gin.New()
	r.Use(gin.Recovery(), middleware.CORSMiddleware(cfg.CORSOrigins), middleware.RequestID(), middleware.RequestLogger(), middleware.TenantFromEmail(), middleware.InputValidation(), middleware.RateLimit(rdb, cfg.RateLimitReqs, time.Duration(cfg.RateLimitWindow)*time.Second))

	// Initialize handlers
	// Dashboard JWTs are only valid for the account's current session.
	sessions := middleware.NewGormSessionStore(db)
	whatsappHandler := handlers.NewWhatsAppHandler(cfg, db, logg, dbService, skService)

	// Create a WhatsApp service instance for notifications
	whatsappService := service.NewWhatsAppService(cfg, logg)
	whatsappService.SetDatabaseService(dbService)
	if skService != nil {
		whatsappService.SetSemanticKernelService(skService)
	}

	notificationHandler := handlers.NewNotificationHandlerWithDB(cfg, db, logg, dbService, whatsappService, skService)

	// Public health check endpoints
	r.GET("/health", handlers.Health)
	r.GET("/version", handlers.GetVersion)

	api := r.Group("/api/v1")
	{
		api.GET("/ping", func(c *gin.Context) { c.JSON(200, gin.H{"message": "pong"}) })

		// Dashboard accounts are created only by /signup (company + super admin)
		// and the dashboard Users page; the Go API has no account-creation route.

		// The handler resolves metadata.phone_number_id then verifies with that
		// tenant's app secret; a global middleware cannot do this safely.
		whatsapp := api.Group("/whatsapp")
		{
			whatsapp.GET("/webhook", whatsappHandler.WhatsAppWebhook)  // For verification
			whatsapp.POST("/webhook", whatsappHandler.WhatsAppWebhook) // For messages
		}

		// Internal API routes - protected by internal API key or JWT
		internal := api.Group("/internal")
		{
			// Apply internal API key middleware if configured, otherwise require JWT
			if cfg.InternalAPIKey != "" {
				internal.Use(middleware.InternalAPIKey(cfg.InternalAPIKey))
			} else {
				internal.Use(middleware.JWTAuth(cfg.JWTAccessSecret, sessions))
			}
			internal.POST("/send-message", whatsappHandler.SendMessage)
			internal.POST("/send-document", whatsappHandler.SendDocument)
			internal.POST("/test-policy-extraction", whatsappHandler.TestPolicyExtraction)
			internal.POST("/test-bot", whatsappHandler.TestBot)
			internal.POST("/notifications/send", notificationHandler.SendNotification)
			internal.POST("/notifications/status-update", notificationHandler.SendStatusUpdateNotification)
		}

		// Protected routes requiring JWT authentication
		protected := api.Group("/protected")
		protected.Use(middleware.JWTAuth(cfg.JWTAccessSecret, sessions))
		{
			// Notification routes
			notifications := protected.Group("/notifications")
			{
				notifications.POST("/send", notificationHandler.SendNotification)
				notifications.POST("/status-update", notificationHandler.SendStatusUpdateNotification)
			}
		}

	}
	return r
}
