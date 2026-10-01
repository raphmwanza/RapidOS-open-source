package middleware

import (
	"net/http"
	"time"
	"github.com/gin-gonic/gin"
	"github.com/redis/go-redis/v9"
	"context"
	"strconv"
)

func RateLimit(rdb *redis.Client, max int, window time.Duration) gin.HandlerFunc {
	return func(c *gin.Context) {
		ip := c.ClientIP()
		key := "rl:" + ip
		ctx := context.Background()
		cnt, err := rdb.Incr(ctx, key).Result()
		if err == nil && cnt == 1 { rdb.Expire(ctx, key, window) }
		if err != nil { c.Next(); return }
		c.Writer.Header().Set("X-RateLimit-Limit", strconv.Itoa(max))
		c.Writer.Header().Set("X-RateLimit-Remaining", strconv.Itoa(max-int(cnt)))
		if int(cnt) > max { c.AbortWithStatusJSON(http.StatusTooManyRequests, gin.H{"error":"rate limit exceeded"}); return }
		c.Next()
	}
}
