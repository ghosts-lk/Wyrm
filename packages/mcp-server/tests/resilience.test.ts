/**
 * Resilience module tests — RetrySync, Circuit Breaker, Checkpointing, Atomic Writes
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync, readFileSync } from 'fs';
import { ResilienceManager } from '../src/resilience.js';
import { WyrmLogger } from '../src/logger.js';

const TEST_DIR = join(process.cwd(), '.test-dbs-resilience');

beforeAll(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
});

afterAll(() => {
  try {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

function createManager(opts?: {
  maxAttempts?: number;
  baseDelayMs?: number;
  failureThreshold?: number;
  successThreshold?: number;
  timeout?: number;
}): ResilienceManager {
  const logger = new WyrmLogger({ level: 'error', console: false });
  return new ResilienceManager(
    logger,
    {
      maxAttempts: opts?.maxAttempts ?? 3,
      baseDelayMs: opts?.baseDelayMs ?? 1, // fast for tests
      maxDelayMs: 10,
      backoffMultiplier: 1,
      retryableErrors: ['SQLITE_BUSY', 'RETRYABLE'],
    },
    {
      failureThreshold: opts?.failureThreshold ?? 3,
      successThreshold: opts?.successThreshold ?? 2,
      timeout: opts?.timeout ?? 10,
    }
  );
}

// ==================== Sync Retry ====================

describe('ResilienceManager — withRetrySync', () => {
  it('succeeds on first attempt', () => {
    const manager = createManager();
    const result = manager.withRetrySync(() => 42, 'test-op');
    expect(result.success).toBe(true);
    expect(result.data).toBe(42);
    expect(result.attempts).toBe(1);
  });

  it('retries on retryable error and eventually succeeds', () => {
    const manager = createManager({ maxAttempts: 5 });
    let attempts = 0;

    const result = manager.withRetrySync(() => {
      attempts++;
      if (attempts < 3) {
        const err = new Error('SQLITE_BUSY');
        (err as any).code = 'SQLITE_BUSY';
        throw err;
      }
      return 'success';
    }, 'retry-op');

    expect(result.success).toBe(true);
    expect(result.data).toBe('success');
    expect(result.attempts).toBe(3);
  });

  it('fails immediately on non-retryable error', () => {
    const manager = createManager();

    const result = manager.withRetrySync(() => {
      throw new Error('PERMISSION_DENIED');
    }, 'non-retry-op');

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.recoverable).toBe(false);
  });

  it('fails after max attempts', () => {
    const manager = createManager({ maxAttempts: 3 });

    const result = manager.withRetrySync(() => {
      const err = new Error('RETRYABLE');
      (err as any).code = 'RETRYABLE';
      throw err;
    }, 'max-retry-op');

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(3);
    expect(result.recoverable).toBe(true);
  });
});

// ==================== Async Retry ====================

describe('ResilienceManager — withRetry (async)', () => {
  it('succeeds on first attempt', async () => {
    const manager = createManager();
    const result = await manager.withRetry(async () => 'hello', 'async-op');
    expect(result.success).toBe(true);
    expect(result.data).toBe('hello');
  });

  it('retries on async retryable error', async () => {
    const manager = createManager({ maxAttempts: 3 });
    let attempts = 0;

    const result = await manager.withRetry(async () => {
      attempts++;
      if (attempts < 2) throw new Error('SQLITE_BUSY');
      return 'recovered';
    }, 'async-retry-op');

    expect(result.success).toBe(true);
    expect(result.data).toBe('recovered');
    expect(result.attempts).toBe(2);
  });
});

// ==================== Circuit Breaker ====================

describe('ResilienceManager — Circuit Breaker', () => {
  it('starts in closed state', () => {
    const manager = createManager();
    const status = manager.getCircuitStatus();
    expect(status.state).toBe('closed');
    expect(status.failures).toBe(0);
  });

  it('opens after threshold failures', () => {
    const manager = createManager({ failureThreshold: 2, maxAttempts: 1 });

    // Fail 2 times to trigger circuit open
    for (let i = 0; i < 2; i++) {
      manager.withRetrySync(() => {
        throw new Error('fail');
      }, 'circuit-test');
    }

    const status = manager.getCircuitStatus();
    expect(status.state).toBe('open');
  });

  it('blocks operations when circuit is open', () => {
    const manager = createManager({ failureThreshold: 2, maxAttempts: 1, timeout: 60000 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      manager.withRetrySync(() => { throw new Error('fail'); }, 'open-test');
    }

    // Next call should be blocked by circuit breaker
    const result = manager.withRetrySync(() => 'should not run', 'blocked-op');
    expect(result.success).toBe(false);
    expect(result.error?.message).toContain('Circuit breaker');
  });

  it('resets circuit manually', () => {
    const manager = createManager({ failureThreshold: 2, maxAttempts: 1 });

    // Open the circuit
    for (let i = 0; i < 2; i++) {
      manager.withRetrySync(() => { throw new Error('fail'); }, 'reset-test');
    }
    expect(manager.getCircuitStatus().state).toBe('open');

    manager.resetCircuit();
    expect(manager.getCircuitStatus().state).toBe('closed');

    // Should work again
    const result = manager.withRetrySync(() => 'works', 'after-reset');
    expect(result.success).toBe(true);
  });

  it('transitions to half-open after timeout', () => {
    const manager = createManager({ failureThreshold: 2, maxAttempts: 1, timeout: 1 });

    // Open circuit
    for (let i = 0; i < 2; i++) {
      manager.withRetrySync(() => { throw new Error('fail'); }, 'timeout-test');
    }
    expect(manager.getCircuitStatus().state).toBe('open');

    // Wait for timeout (1ms)
    const start = Date.now();
    while (Date.now() - start < 5) { /* busy wait */ }

    // Next call should be allowed (half-open)
    const result = manager.withRetrySync(() => 'half-open-success', 'half-open-test');
    expect(result.success).toBe(true);
  });
});

// ==================== Checkpointing ====================

describe('ResilienceManager — Checkpointing', () => {
  it('creates and retrieves a checkpoint', () => {
    const manager = createManager();
    const opId = manager.generateOperationId('test');

    manager.createCheckpoint(opId, 'batch_insert', 'started', { count: 100 });

    const cp = manager.getCheckpoint(opId);
    expect(cp).toBeDefined();
    expect(cp!.operation).toBe('batch_insert');
    expect(cp!.stage).toBe('started');
    expect(cp!.data.count).toBe(100);
    expect(cp!.completed).toBe(false);

    // Cleanup
    manager.completeCheckpoint(opId);
  });

  it('updates checkpoint stage', () => {
    const manager = createManager();
    const opId = manager.generateOperationId('update');

    manager.createCheckpoint(opId, 'migration', 'init', {});
    manager.updateCheckpoint(opId, 'running', { progress: 50 });

    const cp = manager.getCheckpoint(opId);
    expect(cp!.stage).toBe('running');
    expect(cp!.data.progress).toBe(50);

    manager.completeCheckpoint(opId);
  });

  it('completes and removes checkpoint', () => {
    const manager = createManager();
    const opId = manager.generateOperationId('complete');

    manager.createCheckpoint(opId, 'test', 'done', {});
    manager.completeCheckpoint(opId);

    const ops = manager.getIncompleteOperations();
    expect(ops.find(o => o.id === opId)).toBeUndefined();
  });

  it('tracks incomplete operations', () => {
    const manager = createManager();
    const op1 = manager.generateOperationId('inc1');
    const op2 = manager.generateOperationId('inc2');

    manager.createCheckpoint(op1, 'op1', 'started', {});
    manager.createCheckpoint(op2, 'op2', 'started', {});

    const incomplete = manager.getIncompleteOperations();
    expect(incomplete.length).toBeGreaterThanOrEqual(2);

    manager.completeCheckpoint(op1);
    manager.completeCheckpoint(op2);
  });
});

// ==================== Atomic File Writes ====================

describe('ResilienceManager — Atomic File Operations', () => {
  let manager: ResilienceManager;

  beforeEach(() => {
    manager = createManager();
  });

  it('writes file atomically', () => {
    const filePath = join(TEST_DIR, `atomic-${Date.now()}.txt`);
    const success = manager.atomicWriteFile(filePath, 'atomic content');
    expect(success).toBe(true);
    expect(readFileSync(filePath, 'utf-8')).toBe('atomic content');
  });

  it('reads a file safely', () => {
    const filePath = join(TEST_DIR, `safe-read-${Date.now()}.txt`);
    manager.atomicWriteFile(filePath, 'readable');

    const content = manager.safeReadFile(filePath);
    expect(content).toBe('readable');
  });

  it('returns null for non-existent file', () => {
    const content = manager.safeReadFile('/nonexistent/path.txt');
    expect(content).toBeNull();
  });

  it('falls back to backup file', () => {
    const backup = join(TEST_DIR, `backup-${Date.now()}.txt`);
    manager.atomicWriteFile(backup, 'backup content');

    const content = manager.safeReadFile('/nonexistent/primary.txt', backup);
    expect(content).toBe('backup content');
  });
});

// ==================== Operation ID Generation ====================

describe('ResilienceManager — Operation IDs', () => {
  it('generates unique operation IDs', () => {
    const manager = createManager();
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(manager.generateOperationId('test'));
    }
    expect(ids.size).toBe(100);
  });

  it('uses custom prefix', () => {
    const manager = createManager();
    const id = manager.generateOperationId('batch');
    expect(id).toMatch(/^batch-/);
  });
});
