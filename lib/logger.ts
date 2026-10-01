/**
 * Production-ready logger for the Rapidos application.
 * Structured logging with correlation IDs and log levels.
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
  correlationId?: string;
  userId?: string;
  action?: string;
  [key: string]: unknown;
}

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: LogContext;
  error?: {
    message: string;
    stack?: string;
    name: string;
  };
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

// Get log level from environment, default to 'info' in production
const getMinLogLevel = (): LogLevel => {
  const env = process.env.NODE_ENV;
  const configuredLevel = process.env.LOG_LEVEL as LogLevel;
  
  if (configuredLevel && LOG_LEVELS[configuredLevel] !== undefined) {
    return configuredLevel;
  }
  
  return env === 'development' ? 'debug' : 'info';
};

// Generate a unique correlation ID for request tracing
export const generateCorrelationId = (): string => {
  const timestamp = Date.now().toString(36);
  const randomPart = Math.random().toString(36).substring(2, 10);
  return `${timestamp}-${randomPart}`;
};

// Store for the current request's correlation ID (for server-side use)
let currentCorrelationId: string | undefined;

export const setCorrelationId = (id: string): void => {
  currentCorrelationId = id;
};

export const getCorrelationId = (): string | undefined => {
  return currentCorrelationId;
};

const formatLogEntry = (entry: LogEntry): string => {
  if (process.env.NODE_ENV === 'development') {
    // Human-readable format for development
    const { timestamp, level, message, context, error } = entry;
    let output = `[${timestamp}] ${level.toUpperCase()}: ${message}`;
    
    if (context && Object.keys(context).length > 0) {
      output += ` | ${JSON.stringify(context)}`;
    }
    
    if (error) {
      output += ` | Error: ${error.message}`;
    }
    
    return output;
  }
  
  // JSON format for production (structured logging)
  return JSON.stringify(entry);
};

const shouldLog = (level: LogLevel): boolean => {
  const minLevel = getMinLogLevel();
  return LOG_LEVELS[level] >= LOG_LEVELS[minLevel];
};

const createLogEntry = (
  level: LogLevel,
  message: string,
  context?: LogContext,
  error?: Error
): LogEntry => {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  
  // Add correlation ID if available
  const correlationId = context?.correlationId || currentCorrelationId;
  if (correlationId || context) {
    entry.context = {
      ...context,
      correlationId,
    };
  }
  
  if (error) {
    entry.error = {
      message: error.message,
      stack: error.stack,
      name: error.name,
    };
  }
  
  return entry;
};

const log = (level: LogLevel, message: string, context?: LogContext, error?: Error): void => {
  if (!shouldLog(level)) return;
  
  const entry = createLogEntry(level, message, context, error);
  const formatted = formatLogEntry(entry);
  
  switch (level) {
    case 'debug':
    case 'info':
      // eslint-disable-next-line no-console
      console.log(formatted);
      break;
    case 'warn':
      // eslint-disable-next-line no-console
      console.warn(formatted);
      break;
    case 'error':
      // eslint-disable-next-line no-console
      console.error(formatted);
      break;
  }
};

export const logger = {
  debug: (message: string, context?: LogContext): void => {
    log('debug', message, context);
  },
  
  info: (message: string, context?: LogContext): void => {
    log('info', message, context);
  },
  
  warn: (message: string, context?: LogContext): void => {
    log('warn', message, context);
  },
  
  error: (message: string, error?: Error | unknown, context?: LogContext): void => {
    const err = error instanceof Error ? error : undefined;
    const ctx = error instanceof Error ? context : (error as LogContext);
    log('error', message, ctx, err);
  },
  
  // Create a child logger with preset context
  child: (defaultContext: LogContext) => ({
    debug: (message: string, context?: LogContext): void => {
      log('debug', message, { ...defaultContext, ...context });
    },
    info: (message: string, context?: LogContext): void => {
      log('info', message, { ...defaultContext, ...context });
    },
    warn: (message: string, context?: LogContext): void => {
      log('warn', message, { ...defaultContext, ...context });
    },
    error: (message: string, error?: Error | unknown, context?: LogContext): void => {
      const err = error instanceof Error ? error : undefined;
      const ctx = error instanceof Error ? context : (error as LogContext);
      log('error', message, { ...defaultContext, ...ctx }, err);
    },
  }),
};

export default logger;
