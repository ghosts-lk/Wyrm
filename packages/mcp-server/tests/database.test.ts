/**
 * Database module tests — CRUD operations, FTS search, and data lake
 * 
 * Uses a unique temp-file database per test suite to avoid conflicts
 * with the production ~/.wyrm/wyrm.db
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { WyrmDB } from '../src/database.js';
import type { Session, Quest, DataPoint } from '../src/database.js';

const TEST_DB_DIR = join(process.cwd(), '.test-dbs');
let dbCounter = 0;

function createTestDB(): WyrmDB {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return new WyrmDB(join(TEST_DB_DIR, `test-${process.pid}-${++dbCounter}.db`));
}

afterAll(() => {
  // Clean up test databases
  try {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore cleanup errors */ }
});

// ==================== Database Initialization ====================

describe('WyrmDB initialization', () => {
  let db: WyrmDB;

  afterEach(() => {
    db?.close();
  });

  it('creates database and initializes tables', () => {
    db = createTestDB();
    // If constructor completes without throwing, tables are created
    expect(db).toBeDefined();
  });

  it('returns empty project list on fresh database', () => {
    db = createTestDB();
    const projects = db.getAllProjects();
    expect(projects).toEqual([]);
  });

  it('passes integrity check', () => {
    db = createTestDB();
    const result = db.checkIntegrity();
    expect(result.ok).toBe(true);
    expect(result.issues).toHaveLength(0);
  });
});

// ==================== Project CRUD ====================

describe('Project CRUD', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
  });

  afterEach(() => {
    db?.close();
  });

  it('registers a new project', () => {
    const project = db.registerProject('test-app', '/home/test/test-app', undefined, 'typescript');
    expect(project).toBeDefined();
    expect(project.id).toBeGreaterThan(0);
    expect(project.name).toBe('test-app');
    expect(project.path).toBe('/home/test/test-app');
    expect(project.stack).toBe('typescript');
  });

  it('retrieves project by path', () => {
    db.registerProject('my-app', '/home/test/my-app');
    const found = db.getProject('/home/test/my-app');
    expect(found).toBeDefined();
    expect(found!.name).toBe('my-app');
  });

  it('retrieves project by id', () => {
    const created = db.registerProject('by-id', '/home/test/by-id');
    const found = db.getProjectById(created.id);
    expect(found).toBeDefined();
    expect(found!.name).toBe('by-id');
  });

  it('retrieves project by name', () => {
    db.registerProject('by-name', '/home/test/by-name');
    const found = db.getProjectByName('by-name');
    expect(found).toBeDefined();
    expect(found!.path).toBe('/home/test/by-name');
  });

  it('returns undefined for non-existent project', () => {
    expect(db.getProject('/nonexistent')).toBeUndefined();
    expect(db.getProjectById(9999)).toBeUndefined();
    expect(db.getProjectByName('nope')).toBeUndefined();
  });

  it('upserts on conflicting path', () => {
    db.registerProject('v1', '/home/test/upsert', undefined, 'node');
    const updated = db.registerProject('v2', '/home/test/upsert', undefined, 'typescript');
    expect(updated.name).toBe('v2');
    expect(updated.stack).toBe('typescript');
    // Only one project in DB
    expect(db.getAllProjects()).toHaveLength(1);
  });

  it('lists all projects', () => {
    db.registerProject('a', '/home/test/a');
    db.registerProject('b', '/home/test/b');
    db.registerProject('c', '/home/test/c');
    expect(db.getAllProjects()).toHaveLength(3);
  });

  it('searches projects', () => {
    db.registerProject('frontend', '/home/test/frontend', undefined, 'react');
    db.registerProject('backend', '/home/test/backend', undefined, 'node');
    const results = db.searchProjects('react');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('frontend');
  });
});

// ==================== Session CRUD ====================

describe('Session CRUD', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('session-test', '/home/test/session-test').id;
  });

  afterEach(() => {
    db?.close();
  });

  it('creates a session', () => {
    const session = db.createSession(projectId, {
      objectives: 'Build auth module',
      completed: 'Finished login flow',
      notes: 'Needs token refresh',
    });
    expect(session).toBeDefined();
    expect(session.id).toBeGreaterThan(0);
    expect(session.project_id).toBe(projectId);
    expect(session.objectives).toBe('Build auth module');
    expect(session.completed).toBe('Finished login flow');
  });

  it('gets a session by id', () => {
    const created = db.createSession(projectId, { objectives: 'test' });
    const found = db.getSession(created.id);
    expect(found).toBeDefined();
    expect(found!.objectives).toBe('test');
  });

  it('updates a session', () => {
    const session = db.createSession(projectId, { objectives: 'initial' });
    const updated = db.updateSession(session.id, {
      completed: 'all done',
      notes: 'went well',
    });
    expect(updated.completed).toBe('all done');
    expect(updated.notes).toBe('went well');
  });

  it('lists recent sessions', () => {
    db.createSession(projectId, { objectives: 'day 1' });
    db.createSession(projectId, { objectives: 'day 2' });
    db.createSession(projectId, { objectives: 'day 3' });
    const recent = db.getRecentSessions(projectId, 2);
    expect(recent).toHaveLength(2);
  });

  it('calculates token estimates', () => {
    const session = db.createSession(projectId, {
      objectives: 'a'.repeat(100),
    });
    expect(session.tokens_estimate).toBeGreaterThan(0);
  });
});

// ==================== Quest CRUD ====================

describe('Quest CRUD', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('quest-test', '/home/test/quest-test').id;
  });

  afterEach(() => {
    db?.close();
  });

  it('adds a quest', () => {
    const quest = db.addQuest(projectId, 'Fix auth bug', 'Token refresh broken', 'critical');
    expect(quest).toBeDefined();
    expect(quest.id).toBeGreaterThan(0);
    expect(quest.title).toBe('Fix auth bug');
    expect(quest.priority).toBe('critical');
    expect(quest.status).toBe('pending');
  });

  it('updates quest status', () => {
    const quest = db.addQuest(projectId, 'Task', undefined, 'medium');
    const updated = db.updateQuest(quest.id, 'completed');
    expect(updated.status).toBe('completed');
    expect(updated.completed_at).toBeTruthy();
  });

  it('lists pending quests ordered by priority', () => {
    db.addQuest(projectId, 'Low task', undefined, 'low');
    db.addQuest(projectId, 'Critical task', undefined, 'critical');
    db.addQuest(projectId, 'High task', undefined, 'high');
    const pending = db.getPendingQuests(projectId);
    expect(pending).toHaveLength(3);
    expect(pending[0].priority).toBe('critical');
    expect(pending[1].priority).toBe('high');
    expect(pending[2].priority).toBe('low');
  });

  it('lists recently completed quests', () => {
    const q = db.addQuest(projectId, 'Done task');
    db.updateQuest(q.id, 'completed');
    const completed = db.getRecentlyCompleted(projectId);
    expect(completed).toHaveLength(1);
    expect(completed[0].title).toBe('Done task');
  });
});

// ==================== Context ====================

describe('Context', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('ctx-test', '/home/test/ctx-test').id;
  });

  afterEach(() => {
    db?.close();
  });

  it('sets and gets project context', () => {
    db.setContext(projectId, 'framework', 'Next.js');
    expect(db.getContext(projectId, 'framework')).toBe('Next.js');
  });

  it('overwrites existing context', () => {
    db.setContext(projectId, 'version', '1.0');
    db.setContext(projectId, 'version', '2.0');
    expect(db.getContext(projectId, 'version')).toBe('2.0');
  });

  it('returns undefined for missing context', () => {
    expect(db.getContext(projectId, 'nonexistent')).toBeUndefined();
  });

  it('lists all context for a project', () => {
    db.setContext(projectId, 'a', '1');
    db.setContext(projectId, 'b', '2');
    const all = db.getAllContext(projectId);
    expect(all).toEqual({ a: '1', b: '2' });
  });

  it('sets and gets global context', () => {
    db.setGlobalContext('theme', 'dark');
    expect(db.getGlobalContext('theme')).toBe('dark');
  });
});

// ==================== Data Lake ====================

describe('Data Lake', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('data-test', '/home/test/data-test').id;
  });

  afterEach(() => {
    db?.close();
  });

  it('inserts a data point', () => {
    const dp = db.insertData(projectId, 'metrics', 'cpu-usage', '85%', { host: 'server1' });
    expect(dp).toBeDefined();
    expect(dp.id).toBeGreaterThan(0);
    expect(dp.category).toBe('metrics');
    expect(dp.key).toBe('cpu-usage');
    expect(dp.value).toBe('85%');
  });

  it('queries data by project', () => {
    db.insertData(projectId, 'logs', 'error-1', 'null ref');
    db.insertData(projectId, 'logs', 'error-2', 'timeout');
    db.insertData(projectId, 'metrics', 'latency', '200ms');
    const all = db.queryData(projectId);
    expect(all).toHaveLength(3);
  });

  it('queries data by category', () => {
    db.insertData(projectId, 'logs', 'e1', 'error');
    db.insertData(projectId, 'metrics', 'm1', '100');
    const logs = db.queryData(projectId, 'logs');
    expect(logs).toHaveLength(1);
    expect(logs[0].category).toBe('logs');
  });

  it('gets data categories with counts', () => {
    db.insertData(projectId, 'logs', 'a', '1');
    db.insertData(projectId, 'logs', 'b', '2');
    db.insertData(projectId, 'metrics', 'c', '3');
    const cats = db.getDataCategories(projectId);
    expect(cats).toHaveLength(2);
    const logsCat = cats.find(c => c.category === 'logs');
    expect(logsCat?.count).toBe(2);
  });

  it('deletes data category', () => {
    db.insertData(projectId, 'temp', 'x', '1');
    db.insertData(projectId, 'temp', 'y', '2');
    const deleted = db.deleteDataCategory(projectId, 'temp');
    expect(deleted).toBe(2);
    expect(db.queryData(projectId, 'temp')).toHaveLength(0);
  });

  it('batch inserts data', () => {
    const batch = Array.from({ length: 50 }, (_, i) => ({
      projectId,
      category: 'batch',
      key: `item-${i}`,
      value: `value-${i}`,
    }));
    const count = db.insertDataBatch(batch);
    expect(count).toBe(50);
    expect(db.queryData(projectId, 'batch', 100)).toHaveLength(50);
  });
});

// ==================== Full-Text Search ====================

describe('Full-text search', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('fts-test', '/home/test/fts-test').id;
  });

  afterEach(() => {
    db?.close();
  });

  it('searches sessions by content', () => {
    db.createSession(projectId, {
      objectives: 'Implement authentication system',
      completed: 'Login and JWT tokens done',
    });
    db.createSession(projectId, {
      objectives: 'Build dashboard UI',
      completed: 'Charts and graphs working',
    });

    const results = db.searchSessions('authentication', projectId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].objectives).toContain('authentication');
  });

  it('searches quests by title/description', () => {
    db.addQuest(projectId, 'Fix database migration', 'Schema update for v2');
    db.addQuest(projectId, 'Add caching layer', 'Redis integration');

    const results = db.searchQuests('migration');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].title).toContain('migration');
  });

  it('searches data lake by value', () => {
    db.insertData(projectId, 'docs', 'api-spec', 'REST API specification for the authentication service');
    db.insertData(projectId, 'docs', 'readme', 'Project setup guide and installation instructions');

    const results = db.searchData('authentication', projectId);
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].value).toContain('authentication');
  });

  it('returns empty array for no matches', () => {
    db.createSession(projectId, { objectives: 'hello' });
    const results = db.searchSessions('zzzznonexistentzzzz', projectId);
    expect(results).toHaveLength(0);
  });

  it('handles multi-word search queries', () => {
    db.createSession(projectId, {
      objectives: 'Refactor the user profile component',
    });
    // FTS should match individual terms
    const results = db.searchSessions('user profile', projectId);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ==================== Statistics ====================

describe('Statistics', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
  });

  afterEach(() => {
    db?.close();
  });

  it('returns global stats', () => {
    const p = db.registerProject('stats-test', '/home/test/stats-test');
    db.createSession(p.id, { objectives: 'test' });
    db.addQuest(p.id, 'quest');
    db.insertData(p.id, 'cat', 'key', 'value');

    const stats = db.getStats();
    expect(stats.projects).toBe(1);
    expect(stats.sessions).toBe(1);
    expect(stats.quests).toBe(1);
    expect(stats.dataPoints).toBe(1);
  });

  it('returns per-project stats', () => {
    const p = db.registerProject('pstats', '/home/test/pstats');
    db.createSession(p.id, { objectives: 'session' });
    db.addQuest(p.id, 'pending quest', undefined, 'high');
    const q = db.addQuest(p.id, 'done quest');
    db.updateQuest(q.id, 'completed');

    const stats = db.getProjectStats(p.id);
    expect(stats.sessions).toBe(1);
    expect(stats.quests.pending).toBe(1);
    expect(stats.quests.completed).toBe(1);
  });
});
