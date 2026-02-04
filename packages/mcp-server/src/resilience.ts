/**
 * Wyrm Resilience Module - Professional-grade fault tolerance
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module resilience
 * @version 3.0.0
 * 
 * Features:
 * - Transaction safety with automatic rollback
 * - Exponential backoff retry logic
 * - Circuit breaker pattern
 * - Operation checkpointing
 * - Crash recovery via WAL
 * - Graceful degradation
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, readdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { WyrmLogger } from './logger.js';

// ==================== TYPES ====================

export interface RetryConfig {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  backoffMultiplier: number;
  retryableErrors?: string[];
}

export interface CircuitBreakerConfig {
  failureThreshold: number;
  successThreshold: number;
  timeout: number; // ms before attempting half-open
}

export interface CheckpointData {
  id: string;
  operation: string;
  stage: string;
  data: Record<string, unknown>;
  timestamp: string;
  completed: boolean;
}

export interface OperationResult<T> {
  success: boolean;
  data?: T;
  error?: Error;
  attempts: number;
  recoverable: boolean;
}

type CircuitState = 'closed' | 'open' | 'half-open';

// ==================== DEFAULT CONFIGS ====================

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 5,
  baseDelayMs: 100,
  maxDelayMs: 10000,
  backoffMultiplier: 2,
  retryableErrors: [
    'SQLITE_BUSY',
    'SQLITE_LOCKED',
    'ECONNRESET',
    'ETIMEDOUT',
    'ENOTFOUND',
    'EAI_AGAIN',
    'EPIPE',
    'ECONNREFUSED',
  ],
};

const DEFAULT_CIRCUIT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  successThreshold: 3,
  timeout: 30000,
};

// ==================== RESILIENCE MANAGER ====================

export class ResilienceManager {
  private logger: WyrmLogger;
  private checkpointDir: string;
  private retryConfig: RetryConfig;
  private circuitConfig: CircuitBreakerConfig;
  
  // Circuit breaker state
  private circuitState: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private lastFailureTime = 0;
  
  // Active operations for tracking
  private activeOperations: Map<string, CheckpointData> = new Map();
  
  constructor(
    logger?: WyrmLogger,
    retryConfig?: Partial<RetryConfig>,
    circuitConfig?: Partial<CircuitBreakerConfig>
  ) {
    this.logger = logger || new WyrmLogger();
    this.retryConfig = { ...DEFAULT_RETRY_CONFIG, ...retryConfig };
    this.circuitConfig = { ...DEFAULT_CIRCUIT_CONFIG, ...circuitConfig };
    
    // Initialize checkpoint directory
    this.checkpointDir = join(homedir(), '.wyrm', 'checkpoints');
    if (!existsSync(this.checkpointDir)) {
      mkdirSync(this.checkpointDir, { recursive: true });
    }
    
    // Recover any incomplete operations on startup
    this.recoverIncompleteOperations();
  }
  
  // ==================== RETRY WITH BACKOFF ====================
  
  /**
   * Execute an operation with exponential backoff retry
   */
  async withRetry<T>(
    operation: () => Promise<T>,
    operationName: string,
    config?: Partial<RetryConfig>
  ): Promise<OperationResult<T>> {
    const cfg = { ...this.retryConfig, ...config };
    let lastError: Error | undefined;
    let attempts = 0;
    
    while (attempts < cfg.maxAttempts) {
      attempts++;
      
      try {
        // Check circuit breaker
        if (!this.checkCircuit()) {
          return {
            success: false,
            error: new Error('Circuit breaker is open - service unavailable'),
            attempts,
            recoverable: true,
          };
        }
        
        const result = await operation();
        this.recordSuccess();
        
        return {
          success: true,
          data: result,
          attempts,
          recoverable: false,
        };
      } catch (error) {
        lastError = error as Error;
        this.recordFailure();
        
        const errorCode = (error as NodeJS.ErrnoException).code || '';
        const errorMessage = (error as Error).message || '';
        
        // Check if error is retryable
        const isRetryable = cfg.retryableErrors?.some(
          code => errorCode.includes(code) || errorMessage.includes(code)
        );
        
        if (!isRetryable && attempts === 1) {
          // Non-retryable error on first attempt
          this.logger.error(`${operationName} failed with non-retryable error`, {
            error: errorMessage,
            code: errorCode,
          });
          
          return {
            success: false,
            error: lastError,
            attempts,
            recoverable: false,
          };
        }
        
        if (attempts < cfg.maxAttempts) {
          const delay = Math.min(
            cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempts - 1),
            cfg.maxDelayMs
          );
          
          this.logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
            attempt: attempts,
            maxAttempts: cfg.maxAttempts,
            error: errorMessage,
          });
          
          await this.sleep(delay);
        }
      }
    }
    
    this.logger.error(`${operationName} failed after ${attempts} attempts`, {
      error: lastError?.message,
    });
    
    return {
      success: false,
      error: lastError,
      attempts,
      recoverable: true,
    };
  }
  
  /**
   * Synchronous retry for database operations
   */
  withRetrySync<T>(
    operation: () => T,
    operationName: string,
    config?: Partial<RetryConfig>
  ): OperationResult<T> {
    const cfg = { ...this.retryConfig, ...config };
    let lastError: Error | undefined;
    let attempts = 0;
    
    while (attempts < cfg.maxAttempts) {
      attempts++;
      
      try {
        if (!this.checkCircuit()) {
          return {
            success: false,
            error: new Error('Circuit breaker is open'),
            attempts,
            recoverable: true,
          };
        }
        
        const result = operation();
        this.recordSuccess();
        
        return {
          success: true,
          data: result,
          attempts,
          recoverable: false,
        };
      } catch (error) {
        lastError = error as Error;
        this.recordFailure();
        
        const errorCode = (error as NodeJS.ErrnoException).code || '';
        const errorMessage = (error as Error).message || '';
        
        const isRetryable = cfg.retryableErrors?.some(
          code => errorCode.includes(code) || errorMessage.includes(code)
        );
        
        if (!isRetryable && attempts === 1) {
          return {
            success: false,
            error: lastError,
            attempts,
            recoverable: false,
          };
        }
        
        if (attempts < cfg.maxAttempts) {
          const delay = Math.min(
            cfg.baseDelayMs * Math.pow(cfg.backoffMultiplier, attempts - 1),
            cfg.maxDelayMs
          );
          
          this.logger.warn(`${operationName} sync retry ${attempts}/${cfg.maxAttempts}`);
          this.sleepSync(delay);
        }
      }
    }
    
    return {
      success: false,
      error: lastError,
      attempts,
      recoverable: true,
    };
  }
  
  // ==================== CIRCUIT BREAKER ====================
  
  /**
   * Check if circuit allows operations
   */
  private checkCircuit(): boolean {
    switch (this.circuitState) {
      case 'closed':
        return true;
        
      case 'open':
        // Check if timeout has passed
        if (Date.now() - this.lastFailureTime >= this.circuitConfig.timeout) {
          this.circuitState = 'half-open';
          this.logger.info('Circuit breaker transitioning to half-open');
          return true;
        }
        return false;
        
      case 'half-open':
        return true;
    }
  }
  
  /**
   * Record a successful operation
   */
  private recordSuccess(): void {
    if (this.circuitState === 'half-open') {
      this.successCount++;
      if (this.successCount >= this.circuitConfig.successThreshold) {
        this.circuitState = 'closed';
        this.failureCount = 0;
        this.successCount = 0;
        this.logger.info('Circuit breaker closed - service recovered');
      }
    } else {
      this.failureCount = 0;
    }
  }
  
  /**
   * Record a failed operation
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.circuitState === 'half-open') {
      this.circuitState = 'open';
      this.successCount = 0;
      this.logger.warn('Circuit breaker reopened after half-open failure');
    } else if (this.failureCount >= this.circuitConfig.failureThreshold) {
      this.circuitState = 'open';
      this.logger.warn('Circuit breaker opened due to failure threshold', {
        failures: this.failureCount,
        threshold: this.circuitConfig.failureThreshold,
      });
    }
  }
  
  /**
   * Get circuit breaker status
   */
  getCircuitStatus(): { state: CircuitState; failures: number; lastFailure: number } {
    return {
      state: this.circuitState,
      failures: this.failureCount,
      lastFailure: this.lastFailureTime,
    };
  }
  
  /**
   * Manually reset the circuit breaker
   */
  resetCircuit(): void {
    this.circuitState = 'closed';
    this.failureCount = 0;
    this.successCount = 0;
    this.logger.info('Circuit breaker manually reset');
  }
  
  // ==================== CHECKPOINTING ====================
  
  /**
   * Create a checkpoint for an operation
   */
  createCheckpoint(
    operationId: string,
    operation: string,
    stage: string,
    data: Record<string, unknown>
  ): void {
    const checkpoint: CheckpointData = {
      id: operationId,
      operation,
      stage,
      data,
      timestamp: new Date().toISOString(),
      completed: false,
    };
    
    const filePath = join(this.checkpointDir, `${operationId}.json`);
    writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
    this.activeOperations.set(operationId, checkpoint);
    
    this.logger.debug(`Checkpoint created: ${operation}/${stage}`, { operationId });
  }
  
  /**
   * Update checkpoint stage
   */
  updateCheckpoint(
    operationId: string,
    stage: string,
    data?: Record<string, unknown>
  ): void {
    const existing = this.activeOperations.get(operationId);
    if (!existing) {
      this.logger.warn('Checkpoint not found for update', { operationId });
      return;
    }
    
    const updated: CheckpointData = {
      ...existing,
      stage,
      data: data ? { ...existing.data, ...data } : existing.data,
      timestamp: new Date().toISOString(),
    };
    
    const filePath = join(this.checkpointDir, `${operationId}.json`);
    writeFileSync(filePath, JSON.stringify(updated, null, 2));
    this.activeOperations.set(operationId, updated);
  }
  
  /**
   * Complete a checkpoint (mark as done and remove)
   */
  completeCheckpoint(operationId: string): void {
    const filePath = join(this.checkpointDir, `${operationId}.json`);
    
    if (existsSync(filePath)) {
      // Mark as completed before deletion
      const checkpoint = this.activeOperations.get(operationId);
      if (checkpoint) {
        checkpoint.completed = true;
        writeFileSync(filePath, JSON.stringify(checkpoint, null, 2));
      }
      
      // Move to completed folder or delete
      try {
        unlinkSync(filePath);
      } catch {
        // Ignore deletion errors
      }
    }
    
    this.activeOperations.delete(operationId);
    this.logger.debug('Checkpoint completed', { operationId });
  }
  
  /**
   * Get a checkpoint by ID
   */
  getCheckpoint(operationId: string): CheckpointData | null {
    const cached = this.activeOperations.get(operationId);
    if (cached) return cached;
    
    const filePath = join(this.checkpointDir, `${operationId}.json`);
    if (existsSync(filePath)) {
      try {
        const data = JSON.parse(readFileSync(filePath, 'utf-8'));
        return data as CheckpointData;
      } catch {
        return null;
      }
    }
    
    return null;
  }
  
  /**
   * Recover incomplete operations on startup
   */
  private recoverIncompleteOperations(): void {
    try {
      const files = readdirSync(this.checkpointDir);
      const checkpoints: CheckpointData[] = [];
      
      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        
        const filePath = join(this.checkpointDir, file);
        try {
          const data = JSON.parse(readFileSync(filePath, 'utf-8')) as CheckpointData;
          if (!data.completed) {
            checkpoints.push(data);
            this.activeOperations.set(data.id, data);
          } else {
            // Clean up completed checkpoints
            unlinkSync(filePath);
          }
        } catch {
          // Corrupted checkpoint file, remove it
          try {
            unlinkSync(filePath);
          } catch {
            // Ignore
          }
        }
      }
      
      if (checkpoints.length > 0) {
        this.logger.warn('Found incomplete operations from previous run', {
          count: checkpoints.length,
          operations: checkpoints.map(c => c.operation),
        });
      }
    } catch {
      // Checkpoint directory doesn't exist or not readable
    }
  }
  
  /**
   * Get all incomplete operations for recovery
   */
  getIncompleteOperations(): CheckpointData[] {
    return Array.from(this.activeOperations.values()).filter(c => !c.completed);
  }
  
  // ==================== TRANSACTION WRAPPER ====================
  
  /**
   * Execute a database transaction with automatic rollback on failure
   */
  executeTransaction<T>(
    db: { prepare: (sql: string) => { run: () => void } },
    operations: () => T
  ): OperationResult<T> {
    const operationId = `txn-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    this.createCheckpoint(operationId, 'transaction', 'begin', {});
    
    try {
      db.prepare('BEGIN IMMEDIATE').run();
      this.updateCheckpoint(operationId, 'executing');
      
      const result = operations();
      
      db.prepare('COMMIT').run();
      this.completeCheckpoint(operationId);
      
      return {
        success: true,
        data: result,
        attempts: 1,
        recoverable: false,
      };
    } catch (error) {
      this.logger.error('Transaction failed, rolling back', {
        operationId,
        error: (error as Error).message,
      });
      
      try {
        db.prepare('ROLLBACK').run();
      } catch (rollbackError) {
        this.logger.error('Rollback failed', {
          error: (rollbackError as Error).message,
        });
      }
      
      this.updateCheckpoint(operationId, 'rolled_back', {
        error: (error as Error).message,
      });
      
      return {
        success: false,
        error: error as Error,
        attempts: 1,
        recoverable: true,
      };
    }
  }
  
  // ==================== SAFE FILE OPERATIONS ====================
  
  /**
   * Write file atomically (write to temp, then rename)
   */
  atomicWriteFile(filePath: string, content: string): boolean {
    const tempPath = `${filePath}.tmp.${Date.now()}`;
    
    try {
      writeFileSync(tempPath, content, { encoding: 'utf-8', flag: 'w' });
      renameSync(tempPath, filePath);
      return true;
    } catch (error) {
      this.logger.error('Atomic write failed', {
        filePath,
        error: (error as Error).message,
      });
      
      // Clean up temp file if it exists
      try {
        if (existsSync(tempPath)) {
          unlinkSync(tempPath);
        }
      } catch {
        // Ignore cleanup errors
      }
      
      return false;
    }
  }
  
  /**
   * Read file with fallback to backup
   */
  safeReadFile(filePath: string, backupPath?: string): string | null {
    // Try primary file
    try {
      if (existsSync(filePath)) {
        return readFileSync(filePath, 'utf-8');
      }
    } catch {
      this.logger.warn('Failed to read primary file', { filePath });
    }
    
    // Try backup if provided
    if (backupPath) {
      try {
        if (existsSync(backupPath)) {
          this.logger.info('Using backup file', { backupPath });
          return readFileSync(backupPath, 'utf-8');
        }
      } catch {
        this.logger.error('Failed to read backup file', { backupPath });
      }
    }
    
    return null;
  }
  
  // ==================== UTILITIES ====================
  
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  
  private sleepSync(ms: number): void {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      // Busy wait - not ideal but necessary for sync operations
    }
  }
  
  /**
   * Generate a unique operation ID
   */
  generateOperationId(prefix = 'op'): string {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}

// ==================== SINGLETON INSTANCE ====================

let _resilienceManager: ResilienceManager | null = null;

export function getResilienceManager(): ResilienceManager {
  if (!_resilienceManager) {
    _resilienceManager = new ResilienceManager();
  }
  return _resilienceManager;
}

// ==================== HELPER DECORATORS ====================

/**
 * Decorator to add retry logic to a method
 */
export function withRetry(config?: Partial<RetryConfig>) {
  return function (
    _target: unknown,
    propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: unknown[]) {
      const manager = getResilienceManager();
      const result = await manager.withRetry(
        () => originalMethod.apply(this, args),
        propertyKey,
        config
      );
      
      if (!result.success) {
        throw result.error;
      }
      
      return result.data;
    };
    
    return descriptor;
  };
}

/**
 * Decorator to add checkpointing to a method
 */
export function withCheckpoint(operationName: string) {
  return function (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ) {
    const originalMethod = descriptor.value;
    
    descriptor.value = async function (...args: unknown[]) {
      const manager = getResilienceManager();
      const operationId = manager.generateOperationId(operationName);
      
      manager.createCheckpoint(operationId, operationName, 'started', { args });
      
      try {
        const result = await originalMethod.apply(this, args);
        manager.completeCheckpoint(operationId);
        return result;
      } catch (error) {
        manager.updateCheckpoint(operationId, 'failed', {
          error: (error as Error).message,
        });
        throw error;
      }
    };
    
    return descriptor;
  };
}
