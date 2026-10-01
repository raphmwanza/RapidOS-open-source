package middleware

import (
	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

func RequestID() gin.HandlerFunc { return func(c *gin.Context){ c.Set("request_id", uuid.NewString()); c.Writer.Header().Set("X-Request-ID", c.GetString("request_id")); c.Next() } }
