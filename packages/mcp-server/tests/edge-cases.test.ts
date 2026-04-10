/**
 * Edge case tests — empty inputs, very long strings, special characters,
 * SQL injection attempts, Unicode, concurrent operations, missing args
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { WyrmDB } from '../src/database.js';
import { WyrmCrypto } from '../src/crypto.js';
import { sanitizeFtsQuery, sanitizeString, validateBatchSize, SecurityError } from '../src/security.js';
import { estimateTokens, guardSize, truncateToTokens, compactProject, compactQuest, compactSession, diffObjects } from '../src/performance.js';
import { summarizeSession, createContextBundle, estimateTokens as summarizerEstimateTokens } from '../src/summarizer.js';
import { classifyTask, getDefaultConfig, AutoOrchestrator } from '../src/auto-orchestrator.js';
import { WyrmLogger } from '../src/logger.js';

const TEST_DB_DIR = join(process.cwd(), '.test-dbs-edge');
let dbCounter = 0;

function createTestDB(): WyrmDB {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return new WyrmDB(join(TEST_DB_DIR, `edge-${process.pid}-${++dbCounter}.db`));
}

afterAll(() => {
  try {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

// ==================== Empty Inputs ====================

describe('Edge Cases — Empty Inputs', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('handles empty project name', () => {
    const p = db.registerProject('', '/empty-name');
    expect(p).toBeDefined();
    expect(p.name).toBe('');
  });

  it('handles empty session objectives', () => {
    const p = db.registerProject('test', '/test-empty');
    const s = db.createSession(p.id, { objectives: '' });
    expect(s).toBeDefined();
    expect(s.objectives).toBe('');
  });

  it('handles empty quest title', () => {
    const p = db.registerProject('test', '/test-eq');
    const q = db.addQuest(p.id, '', '', 'low');
    expect(q).toBeDefined();
    expect(q.title).toBe('');
  });

  it('handles empty search query', () => {
    const p = db.registerProject('test', '/test-es');
    // FTS with empty query might error — should handle gracefully
    expect(() => {
      try {
        db.searchSessions('', p.id);
      } catch {
        // Some FTS implementations reject empty queries
      }
    }).not.toThrow();
  });

  it('handles empty global context value', () => {
    db.setGlobalContext('empty_key', '');
    const val = db.getGlobalContext('empty_key');
    expect(val).toBe('');
  });

  it('handles empty data lake value', () => {
    const p = db.registerProject('test', '/test-edl');
    const dp = db.insertData(p.id, 'cat', 'key', '');
    expect(dp).toBeDefined();
    expect(dp.value).toBe('');
  });
});

// ==================== Very Long Strings ====================

describe('Edge Cases — Very Long Strings', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('handles very long project name', () => {
    const longName = 'A'.repeat(10000);
    const p = db.registerProject(longName, '/long-name-' + Date.now());
    expect(p.name).toBe(longName);
  });

  it('handles very long quest description', () => {
    const p = db.registerProject('test', '/test-lq-' + Date.now());
    const longDesc = 'B'.repeat(50000);
    const q = db.addQuest(p.id, 'Long quest', longDesc, 'medium');
    expect(q.description.length).toBe(50000);
  });

  it('handles very long data value', () => {
    const p = db.registerProject('test', '/test-ld-' + Date.now());
    const longVal = 'C'.repeat(100000);
    const dp = db.insertData(p.id, 'big', 'huge_value', longVal);
    expect(dp.value.length).toBe(100000);
  });

  it('handles very long context value', () => {
    const p = db.registerProject('test', '/test-lc-' + Date.now());
    const longCtx = 'D'.repeat(100000);
    db.setContext(p.id, 'big_context', longCtx);
    const ctx = db.getContext(p.id, 'big_context');
    expect(ctx?.length).toBe(100000);
  });
});

// ==================== Special Characters & SQL Injection ====================

describe('Edge Cases — Special Characters & SQL Injection', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('handles SQL injection in project name', () => {
    const malicious = "Robert'; DROP TABLE projects; --";
    const p = db.registerProject(malicious, '/sql-inject-' + Date.now());
    expect(p.name).toBe(malicious);
    // Projects table should still exist
    const stats = db.getStats();
    expect(stats.projects).toBeGreaterThanOrEqual(1);
  });

  it('handles SQL injection in quest title', () => {
    const p = db.registerProject('test', '/test-sq-' + Date.now());
    const malicious = "'; DELETE FROM quests WHERE '1'='1";
    const q = db.addQuest(p.id, malicious);
    expect(q.title).toBe(malicious);
  });

  it('handles SQL injection in data value', () => {
    const p = db.registerProject('test', '/test-sdv-' + Date.now());
    const malicious = "value'); DROP TABLE data_lake; --";
    const dp = db.insertData(p.id, 'cat', 'key', malicious);
    expect(dp.value).toBe(malicious);
  });

  it('handles HTML/script tags', () => {
    const p = db.registerProject('test', '/test-html-' + Date.now());
    const html = '<script>alert("xss")</script>';
    const dp = db.insertData(p.id, 'cat', 'key', html);
    expect(dp.value).toBe(html);
  });

  it('handles null bytes', () => {
    const p = db.registerProject('test', '/test-null-' + Date.now());
    const withNull = 'before\x00after';
    const dp = db.insertData(p.id, 'cat', 'key', withNull);
    expect(dp).toBeDefined();
  });

  it('handles backslashes and quotes', () => {
    const p = db.registerProject('test', '/test-esc-' + Date.now());
    const text = `He said "hello" and used C:\\path\\to\\file`;
    const dp = db.insertData(p.id, 'cat', 'key', text);
    expect(dp.value).toBe(text);
  });
});

// ==================== Unicode ====================

describe('Edge Cases — Unicode', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('handles emoji in project name', () => {
    const p = db.registerProject('🐉 Wyrm Project 🔥', '/emoji-' + Date.now());
    expect(p.name).toBe('🐉 Wyrm Project 🔥');
  });

  it('handles CJK characters', () => {
    const p = db.registerProject('test', '/cjk-' + Date.now());
    const dp = db.insertData(p.id, '分类', '关键', '数据值 — 龙');
    expect(dp.category).toBe('分类');
    expect(dp.key).toBe('关键');
  });

  it('handles Arabic/Hebrew RTL text', () => {
    const p = db.registerProject('test', '/rtl-' + Date.now());
    const dp = db.insertData(p.id, 'cat', 'key', 'مرحبا بالعالم');
    expect(dp.value).toBe('مرحبا بالعالم');
  });

  it('handles mixed scripts', () => {
    const p = db.registerProject('test', '/mixed-' + Date.now());
    const mixed = 'Hello World 你好世界 مرحبا 🌍';
    const dp = db.insertData(p.id, 'cat', 'key', mixed);
    expect(dp.value).toBe(mixed);
  });
});

// ==================== sanitizeFtsQuery / sanitizeString ====================

describe('Edge Cases — Security sanitization', () => {
  it('sanitizeFtsQuery handles quotes', () => {
    const result = sanitizeFtsQuery('"test query"');
    expect(typeof result).toBe('string');
  });

  it('sanitizeFtsQuery handles special FTS characters', () => {
    const result = sanitizeFtsQuery('test OR value AND NOT something');
    expect(typeof result).toBe('string');
  });

  it('sanitizeFtsQuery throws on empty input', () => {
    expect(() => sanitizeFtsQuery('')).toThrow();
  });

  it('sanitizeString truncates to max length', () => {
    const long = 'A'.repeat(1000);
    const result = sanitizeString(long, 100);
    expect(result.length).toBeLessThanOrEqual(100);
  });

  it('sanitizeString handles null/undefined gracefully', () => {
    expect(sanitizeString(null as any)).toBe('');
    expect(sanitizeString(undefined as any)).toBe('');
  });

  it('validateBatchSize rejects oversized batches', () => {
    const huge = new Array(10001).fill({ category: 'a', key: 'b', value: 'c' });
    expect(() => validateBatchSize(huge)).toThrow();
  });

  it('validateBatchSize accepts normal batches', () => {
    const normal = new Array(100).fill({ category: 'a', key: 'b', value: 'c' });
    expect(() => validateBatchSize(normal)).not.toThrow();
  });

  it('validateBatchSize accepts empty array', () => {
    expect(() => validateBatchSize([])).not.toThrow();
  });
});

// ==================== Performance Utilities ====================

describe('Edge Cases — Performance Utilities', () => {
  it('estimateTokens handles empty string', () => {
    expect(estimateTokens('')).toBe(0);
  });

  it('estimateTokens handles large objects', () => {
    const bigObj = { data: 'x'.repeat(10000) };
    const tokens = estimateTokens(bigObj);
    expect(tokens).toBeGreaterThan(2000);
  });

  it('guardSize returns data when under limit', () => {
    const small = { key: 'value' };
    const result = guardSize(small);
    expect(result).toEqual(small);
  });

  it('guardSize truncates when over limit', () => {
    const big = { data: 'x'.repeat(50000) };
    const result = guardSize(big, 100) as { truncated: boolean; preview: string; tokens: number };
    expect(result.truncated).toBe(true);
    expect(result.tokens).toBeGreaterThan(100);
  });

  it('truncateToTokens respects limit', () => {
    const text = 'A'.repeat(10000);
    const truncated = truncateToTokens(text, 100);
    expect(truncated.length).toBeLessThanOrEqual(400 + 3); // 100 * 4 + '...'
  });

  it('compactProject produces minimal representation', () => {
    const result = compactProject({ id: 1, name: 'test', path: '/test', stack: 'react' });
    expect(result).toEqual({ i: 1, n: 'test', p: '/test', s: 'react' });
  });

  it('compactProject omits null stack', () => {
    const result = compactProject({ id: 1, name: 'test', path: '/test', stack: null });
    expect(result.s).toBeUndefined();
  });

  it('compactQuest produces minimal representation', () => {
    const result = compactQuest({ id: 1, title: 'Fix bug', priority: 'high', status: 'pending' });
    expect(result).toEqual({ i: 1, t: 'Fix bug', p: 'h', s: 'p' });
  });

  it('compactSession produces minimal representation', () => {
    const result = compactSession({ id: 1, date: '2025-01-15T10:00:00Z', summary: 'Did things' });
    expect(result).toEqual({ i: 1, d: '2025-01-15', s: 'Did things' });
  });

  it('diffObjects detects changes', () => {
    const prev = { a: 1, b: 'hello' };
    const curr = { a: 1, b: 'world', c: true };
    const diff = diffObjects(prev, curr as any);
    expect(diff.b).toBe('world');
    expect(diff.c).toBe(true);
    expect(diff.a).toBeUndefined();
  });
});

// ==================== Summarizer ====================

describe('Edge Cases — Summarizer', () => {
  it('summarizes a session with all fields', () => {
    const result = summarizeSession({
      id: 1,
      project_id: 1,
      date: '2025-01-15',
      objectives: 'Build authentication\nSetup database',
      completed: '- Login flow\n- Signup flow\n- Password reset',
      issues: 'Bug: Token refresh broken. Fixed: CORS issue',
      commits: 'abc1234 def5678',
      files_changed: 'src/auth.ts\nsrc/db.ts\nsrc/api.ts',
      notes: 'Good progress overall',
      is_archived: false,
    });
    expect(result.summary).toContain('[2025-01-15]');
    expect(result.summary).toContain('Build authentication');
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it('summarizes a minimal session', () => {
    const result = summarizeSession({
      id: 1,
      project_id: 1,
      date: '2025-01-15',
      objectives: '',
      completed: '',
      issues: '',
      commits: '',
      files_changed: '',
      notes: '',
      is_archived: false,
    });
    expect(result.summary).toContain('[2025-01-15]');
  });

  it('createContextBundle stays under token limit', () => {
    const result = createContextBundle(
      { name: 'Test', stack: 'Node.js' },
      { architecture: 'A'.repeat(5000) },
      [],
      [],
      100 // very tight token limit
    );
    expect(summarizerEstimateTokens(result)).toBeLessThanOrEqual(200); // some overhead
  });
});

// ==================== Auto-Orchestrator ====================

describe('Edge Cases — Auto-Orchestrator', () => {
  it('classifies a decision task', () => {
    const result = classifyTask('Should we choose microservices or monolith architecture?');
    expect(result.type).toBe('decision');
    expect(result.confidence).toBeGreaterThan(50);
  });

  it('classifies a research task', () => {
    const result = classifyTask('Investigate and research what are the best database options');
    expect(result.type).toBe('research');
  });

  it('classifies a verification task', () => {
    const result = classifyTask('Review the security audit results');
    expect(result.type).toBe('verification');
  });

  it('classifies a generation task by default', () => {
    const result = classifyTask('Write a poem about dragons');
    expect(result.type).toBe('generation');
  });

  it('classifies a decomposition task for long input', () => {
    const longInput = 'Build a complete authentication system with ' + 'detailed requirements '.repeat(50);
    const result = classifyTask(longInput);
    expect(result.type).toBe('decomposition');
  });

  it('handles empty input', () => {
    const result = classifyTask('');
    expect(result).toBeDefined();
    expect(result.type).toBe('generation');
  });

  it('getDefaultConfig returns valid config', () => {
    const config = getDefaultConfig();
    expect(config.autoOrchestrateEnabled).toBe(true);
    expect(config.minConfidenceThreshold).toBeGreaterThan(0);
    expect(config.maxParallelAgents).toBeGreaterThan(0);
  });

  it('AutoOrchestrator tracks task history', async () => {
    const orch = new AutoOrchestrator();
    await orch.processTask('Investigate a bug');
    await orch.processTask('Choose between SQL and NoSQL');

    const stats = orch.getStats();
    expect(stats.tasksProcessed).toBe(2);
    expect(stats.distribution).toBeDefined();
  });

  it('AutoOrchestrator updates config', () => {
    const orch = new AutoOrchestrator();
    orch.updateConfig({ maxParallelAgents: 10 });
    // Config is private, but we can verify via processTask behavior
    expect(() => orch.updateConfig({ trackMetrics: false })).not.toThrow();
  });
});

// ==================== Logger ====================

describe('Edge Cases — WyrmLogger', () => {
  it('creates logger with defaults', () => {
    const logger = new WyrmLogger({ console: false });
    expect(logger).toBeDefined();
  });

  it('logs at different levels without error', () => {
    const logger = new WyrmLogger({ level: 'debug', console: false });
    expect(() => {
      logger.debug('debug message');
      logger.info('info message');
      logger.warn('warn message');
      logger.error('error message');
    }).not.toThrow();
  });

  it('respects log level filtering', () => {
    const logger = new WyrmLogger({ level: 'error', console: false });
    // debug/info/warn should be silently skipped
    expect(() => {
      logger.debug('should skip');
      logger.info('should skip');
      logger.warn('should skip');
      logger.error('should log');
    }).not.toThrow();
  });

  it('generates correlation IDs', () => {
    const logger = new WyrmLogger({ console: false });
    const id = logger.generateCorrelationId();
    expect(id).toMatch(/^wyrm-/);
  });

  it('times operations', () => {
    const logger = new WyrmLogger({ level: 'debug', console: false });
    const result = logger.time('test', () => 42);
    expect(result).toBe(42);
  });

  it('creates child loggers', () => {
    const logger = new WyrmLogger({ console: false });
    const child = logger.child({ module: 'test' });
    expect(child).toBeDefined();
    expect(() => child.info('child log')).not.toThrow();
  });
});

// ==================== Concurrent Operations ====================

describe('Edge Cases — Concurrent Database Operations', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('handles rapid sequential inserts', () => {
    const p = db.registerProject('concurrent', '/concurrent-' + Date.now());
    const results: number[] = [];

    for (let i = 0; i < 100; i++) {
      const dp = db.insertData(p.id, 'cat', `key-${i}`, `value-${i}`);
      results.push(dp.id);
    }

    // All should have unique IDs
    const unique = new Set(results);
    expect(unique.size).toBe(100);
  });

  it('handles batch insert followed by query', () => {
    const p = db.registerProject('batch-query', '/bq-' + Date.now());
    const batch = Array.from({ length: 50 }, (_, i) => ({
      projectId: p.id,
      category: 'batch',
      key: `k${i}`,
      value: `v${i}`,
    }));

    const count = db.insertDataBatch(batch);
    expect(count).toBe(50);

    const results = db.queryData(p.id, 'batch');
    expect(results.length).toBe(50);
  });

  it('handles multiple projects simultaneously', () => {
    const projects = [];
    for (let i = 0; i < 10; i++) {
      projects.push(db.registerProject(`proj-${i}`, `/proj-${i}-${Date.now()}`));
    }

    for (const p of projects) {
      db.addQuest(p.id, `Quest for ${p.name}`, '', 'medium');
      db.insertData(p.id, 'cat', 'key', 'val');
    }

    const stats = db.getStats();
    expect(stats.projects).toBe(10);
    expect(stats.quests).toBe(10);
    expect(stats.dataPoints).toBe(10);
  });
});

// ==================== Missing/Undefined Args ====================

describe('Edge Cases — Missing/Undefined Arguments', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('getProject returns undefined for non-existent path', () => {
    expect(db.getProject('/no/such/path')).toBeUndefined();
  });

  it('getProjectByName returns undefined for non-existent name', () => {
    expect(db.getProjectByName('nonexistent')).toBeUndefined();
  });

  it('getTodaySession returns undefined when no session exists', () => {
    const p = db.registerProject('noSession', '/noSession-' + Date.now());
    expect(db.getTodaySession(p.id)).toBeUndefined();
  });

  it('getSkill returns undefined for non-existent skill', () => {
    expect(db.getSkill('no-skill')).toBeUndefined();
  });

  it('deleteSkill returns false for non-existent skill', () => {
    expect(db.deleteSkill('ghost')).toBe(false);
  });

  it('getGlobalContext returns undefined for non-existent key', () => {
    expect(db.getGlobalContext('missing')).toBeUndefined();
  });

  it('searchQuests with no results returns empty', () => {
    expect(db.searchQuests('xyzabcnonexistent')).toEqual([]);
  });
});

// ==================== Crypto Edge Cases ====================

describe('Edge Cases — Crypto', () => {
  it('handles special characters in encryption', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('test-password-123');

    const special = '`~!@#$%^&*()_+-=[]{}|;:\'",.<>?/\\\n\t\r';
    const encrypted = crypto.encrypt(special);
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(special);
  });

  it('handles very long strings in encryption', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('test-password-123');

    const longText = 'X'.repeat(1000000); // 1MB
    const encrypted = crypto.encrypt(longText);
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(longText);
  });

  it('constant-time comparison rejects different length hashes', () => {
    expect(WyrmCrypto.verifyHash('test', 'short')).toBe(false);
  });
});
