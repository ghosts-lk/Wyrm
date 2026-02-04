/**
 * Wyrm Logger - Structured logging with log levels
 * 
 * @module logger
 * @version 3.0.0
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  context?: Record<string, unknown>;
  correlationId?: string;
}

export interface LoggerConfig {
  level: LogLevel;
  file?: string;
  console?: boolean;
  json?: boolean;
}

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_COLORS: Record<LogLevel, string> = {
  debug: '\x1b[36m', // Cyan
  info: '\x1b[32m',  // Green
  warn: '\x1b[33m',  // Yellow
  error: '\x1b[31m', // Red
};

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const DIM = '\x1b[2m';

/**
 * Wyrm Logger - Structured logging for the memory system
 */
export class WyrmLogger {
  private config: LoggerConfig;
  private correlationId?: string;
  private logDir: string;

  constructor(config?: Partial<LoggerConfig>) {
    this.config = {
      level: config?.level ?? 'info',
      console: config?.console ?? true,
      json: config?.json ?? false,
      file: config?.file,
    };

    this.logDir = join(homedir(), '.wyrm', 'logs');
    if (!existsSync(this.logDir)) {
      mkdirSync(this.logDir, { recursive: true });
    }
  }

  /**
   * Set correlation ID for request tracing
   */
  setCorrelationId(id: string): void {
    this.correlationId = id;
  }

  /**
   * Generate a new correlation ID
   */
  generateCorrelationId(): string {
    this.correlationId = `wyrm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return this.correlationId;
  }

  /**
   * Check if a log level should be logged
   */
  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVELS[level] >= LOG_LEVELS[this.config.level];
  }

  /**
   * Format log entry
   */
  private format(entry: LogEntry): string {
    if (this.config.json) {
      return JSON.stringify(entry);
    }

    const color = LOG_COLORS[entry.level];
    const levelStr = entry.level.toUpperCase().padEnd(5);
    const time = entry.timestamp.split('T')[1]?.split('.')[0] || entry.timestamp;
    
    let msg = `${DIM}${time}${RESET} ${color}${BOLD}${levelStr}${RESET} ${entry.message}`;
    
    if (entry.context && Object.keys(entry.context).length > 0) {
      msg += ` ${DIM}${JSON.stringify(entry.context)}${RESET}`;
    }
    
    if (entry.correlationId) {
      msg += ` ${DIM}[${entry.correlationId}]${RESET}`;
    }
    
    return msg;
  }

  /**
   * Write log entry
   */
  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) return;

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context,
      correlationId: this.correlationId,
    };

    const formatted = this.format(entry);

    if (this.config.console) {
      const stream = level === 'error' ? console.error : console.log;
      stream(formatted);
    }

    if (this.config.file) {
      try {
        const logPath = join(this.logDir, this.config.file);
        appendFileSync(logPath, (this.config.json ? formatted : JSON.stringify(entry)) + '\n');
      } catch {
        // Silent fail for file writes
      }
    }
  }

  // Log level methods
  debug(message: string, context?: Record<string, unknown>): void {
    this.log('debug', message, context);
  }

  info(message: string, context?: Record<string, unknown>): void {
    this.log('info', message, context);
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.log('warn', message, context);
  }

  error(message: string, context?: Record<string, unknown>): void {
    this.log('error', message, context);
  }

  /**
   * Log with timing measurement
   */
  time<T>(label: string, fn: () => T): T {
    const start = performance.now();
    try {
      const result = fn();
      const duration = performance.now() - start;
      this.debug(`${label} completed`, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`${label} failed`, { duration: `${duration.toFixed(2)}ms`, error: String(error) });
      throw error;
    }
  }

  /**
   * Async timing
   */
  async timeAsync<T>(label: string, fn: () => Promise<T>): Promise<T> {
    const start = performance.now();
    try {
      const result = await fn();
      const duration = performance.now() - start;
      this.debug(`${label} completed`, { duration: `${duration.toFixed(2)}ms` });
      return result;
    } catch (error) {
      const duration = performance.now() - start;
      this.error(`${label} failed`, { duration: `${duration.toFixed(2)}ms`, error: String(error) });
      throw error;
    }
  }

  /**
   * Create a child logger with additional context
   */
  child(context: Record<string, unknown>): WyrmLogger {
    const child = new WyrmLogger(this.config);
    child.correlationId = this.correlationId;
    const originalLog = child.log.bind(child);
    child.log = (level: LogLevel, message: string, ctx?: Record<string, unknown>) => {
      originalLog(level, message, { ...context, ...ctx });
    };
    return child;
  }
}

// Default logger instance
let defaultLogger: WyrmLogger | null = null;

export function getLogger(): WyrmLogger {
  if (!defaultLogger) {
    defaultLogger = new WyrmLogger({
      level: process.env.WYRM_LOG_LEVEL as LogLevel || 'info',
      console: process.env.WYRM_LOG_CONSOLE !== 'false',
      json: process.env.WYRM_LOG_JSON === 'true',
      file: 'wyrm.log',
    });
  }
  return defaultLogger;
}

export function createLogger(config: Partial<LoggerConfig>): WyrmLogger {
  return new WyrmLogger(config);
}

// Convenience exports
export const logger = {
  debug: (msg: string, ctx?: Record<string, unknown>) => getLogger().debug(msg, ctx),
  info: (msg: string, ctx?: Record<string, unknown>) => getLogger().info(msg, ctx),
  warn: (msg: string, ctx?: Record<string, unknown>) => getLogger().warn(msg, ctx),
  error: (msg: string, ctx?: Record<string, unknown>) => getLogger().error(msg, ctx),
};
