package handlers

import "github.com/gin-gonic/gin"

var Version = "0.1.0"

func GetVersion(c *gin.Context) { c.JSON(200, gin.H{"version": Version}) }
