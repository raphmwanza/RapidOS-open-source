package logger

import (
	"encoding/json"
	"log"
	"os"
	"time"
)

// LogLevel represents the severity of a log message
type LogLevel string

const (
	DEBUG LogLevel = "DEBUG"
	INFO  LogLevel = "INFO"
	WARN  LogLevel = "WARN"
	ERROR LogLevel = "ERROR"
	FATAL LogLevel = "FATAL"
)

// LogEntry represents a structured log entry
type LogEntry struct {
	Timestamp string                 `json:"timestamp"`
	Level     LogLevel               `json:"level"`
	Message   string                 `json:"message"`
	Fields    map[string]interface{} `json:"fields,omitempty"`
}

// Logger wraps the standard logger with structured logging
type Logger struct{}

// New creates a new Logger instance
func New() *Logger { return &Logger{} }

// logJSON outputs a JSON-formatted log entry
func logJSON(level LogLevel, message string, fields map[string]interface{}) {
	entry := LogEntry{
		Timestamp: time.Now().UTC().Format(time.RFC3339),
		Level:     level,
		Message:   message,
		Fields:    fields,
	}

	jsonBytes, err := json.Marshal(entry)
	if err != nil {
		log.Printf("%s: %s %v", level, message, fields)
		return
	}

	os.Stdout.Write(append(jsonBytes, '\n'))
}

// Package-level functions for convenience
func Debug(message string, fields map[string]interface{}) {
	if os.Getenv("LOG_LEVEL") == "debug" {
		logJSON(DEBUG, message, fields)
	}
}

func Info(message string, fields map[string]interface{}) {
	logJSON(INFO, message, fields)
}

func Warn(message string, fields map[string]interface{}) {
	logJSON(WARN, message, fields)
}

func Error(message string, fields map[string]interface{}) {
	logJSON(ERROR, message, fields)
}

func Fatal(message string, fields map[string]interface{}) {
	logJSON(FATAL, message, fields)
	os.Exit(1)
}

// Instance methods for backward compatibility
func (l *Logger) Infof(f string, a ...interface{})  { log.Printf("INFO: "+f, a...) }
func (l *Logger) Warnf(f string, a ...interface{})  { log.Printf("WARN: "+f, a...) }
func (l *Logger) Errorf(f string, a ...interface{}) { log.Printf("ERROR: "+f, a...) }
func (l *Logger) Fatalf(f string, a ...interface{}) { log.Fatalf("FATAL: "+f, a...) }
