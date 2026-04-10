/**
 * Tool handler integration tests
 * 
 * Tests the core WyrmDB methods that back each MCP tool handler.
 * Uses real database instances (no mocks) with temp file DBs.
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync, mkdtempSync, writeFileSync } from 'fs';
import { WyrmDB } from '../src/database.js';
import type { Session, Quest, DataPoint, Skill } from '../src/database.js';

const TEST_DB_DIR = join(process.cwd(), '.test-dbs-tools');
let dbCounter = 0;

function createTestDB(): WyrmDB {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return new WyrmDB(join(TEST_DB_DIR, `tools-${process.pid}-${++dbCounter}.db`));
}

afterAll(() => {
  try {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

// ==================== wyrm_scan_projects ====================

describe('wyrm_scan_projects (scanForProjects)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('returns empty array for path with no git repos', () => {
    const tempDir = join(TEST_DB_DIR, `scan-empty-${Date.now()}`);
    mkdirSync(tempDir, { recursive: true });
    const projects = db.scanForProjects(tempDir, true);
    expect(projects).toEqual([]);
  });

  it('discovers a git project in a directory', () => {
    const tempDir = join(TEST_DB_DIR, `scan-git-${Date.now()}`);
    const fakeProject = join(tempDir, 'my-project');
    mkdirSync(join(fakeProject, '.git'), { recursive: true });
    // scanForProjects looks for .git dirs
    const projects = db.scanForProjects(tempDir, true);
    expect(projects.length).toBeGreaterThanOrEqual(1);
    expect(projects[0].name).toBe('my-project');
  });

  it('adds watch directory when requested', () => {
    const watchDir = db.addWatchDir('/some/dir', true);
    expect(watchDir).toBeDefined();
    expect(watchDir.path).toBe('/some/dir');

    const dirs = db.getWatchDirs();
    expect(dirs.length).toBe(1);
  });
});

// ==================== wyrm_list_projects ====================

describe('wyrm_list_projects (getAllProjects, searchProjects)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('lists all projects', () => {
    db.registerProject('alpha', '/alpha');
    db.registerProject('beta', '/beta');
    const all = db.getAllProjects();
    expect(all.length).toBe(2);
  });

  it('respects limit parameter', () => {
    for (let i = 0; i < 10; i++) {
      db.registerProject(`p${i}`, `/p${i}`);
    }
    const limited = db.getAllProjects(3);
    expect(limited.length).toBe(3);
  });

  it('searches projects by name/stack', () => {
    db.registerProject('frontend', '/frontend', undefined, 'react');
    db.registerProject('backend', '/backend', undefined, 'express');
    const results = db.searchProjects('react');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});

// ==================== wyrm_project_context ====================

describe('wyrm_project_context (getProject, getAllContext, getRecentSessions, getPendingQuests)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('ctx-app', '/ctx-app').id;
    db.setContext(projectId, 'framework', 'Next.js 14');
    db.createSession(projectId, { objectives: 'Build auth' });
    db.addQuest(projectId, 'Fix login bug', 'Token expired issue', 'high');
  });
  afterEach(() => { db?.close(); });

  it('retrieves project by path', () => {
    const project = db.getProject('/ctx-app');
    expect(project).toBeDefined();
    expect(project!.name).toBe('ctx-app');
  });

  it('retrieves project by name', () => {
    const project = db.getProjectByName('ctx-app');
    expect(project).toBeDefined();
  });

  it('gathers full context for a project', () => {
    const ctx = db.getAllContext(projectId);
    expect(ctx.framework).toBe('Next.js 14');

    const sessions = db.getRecentSessions(projectId, 5);
    expect(sessions.length).toBe(1);

    const quests = db.getPendingQuests(projectId);
    expect(quests.length).toBe(1);
    expect(quests[0].title).toBe('Fix login bug');
  });
});

// ==================== wyrm_global_context ====================

describe('wyrm_global_context (getAllGlobalContext, getAllPendingQuests)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('returns global context entries', () => {
    db.setGlobalContext('ai_provider', 'claude');
    db.setGlobalContext('org_name', 'Ghost Protocol');
    const ctx = db.getAllGlobalContext();
    expect(ctx.ai_provider).toBe('claude');
    expect(ctx.org_name).toBe('Ghost Protocol');
  });

  it('returns all pending quests across projects', () => {
    const p1 = db.registerProject('p1', '/p1').id;
    const p2 = db.registerProject('p2', '/p2').id;
    db.addQuest(p1, 'Task A', '', 'high');
    db.addQuest(p2, 'Task B', '', 'low');
    const quests = db.getAllPendingQuests();
    expect(quests.length).toBe(2);
  });
});

// ==================== wyrm_session_start / wyrm_session_update ====================

describe('wyrm_session_start / wyrm_session_update', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('session-app', '/session-app').id;
  });
  afterEach(() => { db?.close(); });

  it('creates a new session', () => {
    const session = db.createSession(projectId, { objectives: 'Build API' });
    expect(session).toBeDefined();
    expect(session.objectives).toBe('Build API');
  });

  it('retrieves today session', () => {
    db.createSession(projectId, { objectives: 'Today work' });
    const today = db.getTodaySession(projectId);
    expect(today).toBeDefined();
    expect(today!.objectives).toBe('Today work');
  });

  it('updates a session with completed work', () => {
    const s = db.createSession(projectId, { objectives: 'Build auth' });
    const updated = db.updateSession(s.id, {
      completed: 'Login flow done',
      issues: 'Token refresh needs work',
      notes: 'Good progress',
    });
    expect(updated.completed).toBe('Login flow done');
    expect(updated.issues).toBe('Token refresh needs work');
    expect(updated.notes).toBe('Good progress');
  });

  it('archives old sessions', () => {
    // Create 15 sessions
    for (let i = 0; i < 15; i++) {
      db.createSession(projectId, { objectives: `Session ${i}` });
    }
    const archived = db.archiveOldSessions(projectId, 5);
    expect(archived).toBe(10); // 15 - 5 = 10 archived
  });
});

// ==================== wyrm_quest_add / wyrm_quest_complete ====================

describe('wyrm_quest_add / wyrm_quest_complete', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('quest-app', '/quest-app').id;
  });
  afterEach(() => { db?.close(); });

  it('adds a quest with all fields', () => {
    const q = db.addQuest(projectId, 'Fix CI', 'Pipeline broken', 'critical', 'ci,devops');
    expect(q.title).toBe('Fix CI');
    expect(q.description).toBe('Pipeline broken');
    expect(q.priority).toBe('critical');
    expect(q.tags).toBe('ci,devops');
    expect(q.status).toBe('pending');
  });

  it('completes a quest', () => {
    const q = db.addQuest(projectId, 'Deploy v2');
    const completed = db.updateQuest(q.id, 'completed');
    expect(completed.status).toBe('completed');
    expect(completed.completed_at).toBeTruthy();
  });

  it('defaults priority to medium', () => {
    const q = db.addQuest(projectId, 'Default priority task');
    expect(q.priority).toBe('medium');
  });
});

// ==================== wyrm_all_quests ====================

describe('wyrm_all_quests (getAllPendingQuests)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('lists all pending quests ordered by priority', () => {
    const p = db.registerProject('multi', '/multi').id;
    db.addQuest(p, 'Low task', '', 'low');
    db.addQuest(p, 'Critical task', '', 'critical');
    db.addQuest(p, 'High task', '', 'high');

    const quests = db.getAllPendingQuests();
    expect(quests[0].priority).toBe('critical');
    expect(quests[1].priority).toBe('high');
    expect(quests[2].priority).toBe('low');
  });

  it('excludes completed quests', () => {
    const p = db.registerProject('comp', '/comp').id;
    const q = db.addQuest(p, 'Done');
    db.updateQuest(q.id, 'completed');
    db.addQuest(p, 'Still pending');

    const pending = db.getAllPendingQuests();
    expect(pending.length).toBe(1);
    expect(pending[0].title).toBe('Still pending');
  });
});

// ==================== wyrm_data_insert ====================

describe('wyrm_data_insert (insertData)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('data-app', '/data-app').id;
  });
  afterEach(() => { db?.close(); });

  it('inserts a data point', () => {
    const dp = db.insertData(projectId, 'config', 'api_url', 'https://api.example.com');
    expect(dp.id).toBeGreaterThan(0);
    expect(dp.category).toBe('config');
    expect(dp.key).toBe('api_url');
    expect(dp.value).toBe('https://api.example.com');
  });

  it('inserts data with metadata', () => {
    const dp = db.insertData(projectId, 'metrics', 'cpu', '85%', { host: 'server-1' });
    expect(dp).toBeDefined();
    expect(dp.metadata).toBeTruthy();
  });
});

// ==================== wyrm_data_batch_insert ====================

describe('wyrm_data_batch_insert (insertDataBatch)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('batch-app', '/batch-app').id;
  });
  afterEach(() => { db?.close(); });

  it('batch inserts multiple data points', () => {
    const batch = Array.from({ length: 25 }, (_, i) => ({
      projectId,
      category: 'logs',
      key: `entry-${i}`,
      value: `Log message ${i}`,
    }));
    const count = db.insertDataBatch(batch);
    expect(count).toBe(25);
  });

  it('handles empty batch', () => {
    const count = db.insertDataBatch([]);
    expect(count).toBe(0);
  });
});

// ==================== wyrm_data_query ====================

describe('wyrm_data_query (queryData)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('query-app', '/query-app').id;
    db.insertData(projectId, 'config', 'key1', 'value1');
    db.insertData(projectId, 'logs', 'key2', 'value2');
    db.insertData(projectId, 'config', 'key3', 'value3');
  });
  afterEach(() => { db?.close(); });

  it('queries all data for a project', () => {
    const results = db.queryData(projectId);
    expect(results.length).toBe(3);
  });

  it('filters by category', () => {
    const results = db.queryData(projectId, 'config');
    expect(results.length).toBe(2);
  });

  it('respects limit', () => {
    const results = db.queryData(projectId, undefined, 1);
    expect(results.length).toBe(1);
  });
});

// ==================== wyrm_data_categories ====================

describe('wyrm_data_categories (getDataCategories)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('cat-app', '/cat-app').id;
    db.insertData(projectId, 'logs', 'a', '1');
    db.insertData(projectId, 'logs', 'b', '2');
    db.insertData(projectId, 'metrics', 'c', '3');
  });
  afterEach(() => { db?.close(); });

  it('returns categories with counts', () => {
    const cats = db.getDataCategories(projectId);
    expect(cats.length).toBe(2);
    const logs = cats.find(c => c.category === 'logs');
    expect(logs?.count).toBe(2);
    const metrics = cats.find(c => c.category === 'metrics');
    expect(metrics?.count).toBe(1);
  });
});

// ==================== wyrm_search ====================

describe('wyrm_search (searchSessions, searchQuests, searchData)', () => {
  let db: WyrmDB;
  let projectId: number;

  beforeEach(() => {
    db = createTestDB();
    projectId = db.registerProject('search-app', '/search-app').id;
    db.createSession(projectId, { objectives: 'Implement authentication system' });
    db.addQuest(projectId, 'Fix database migration');
    db.insertData(projectId, 'docs', 'readme', 'Authentication service documentation');
  });
  afterEach(() => { db?.close(); });

  it('searches sessions', () => {
    const results = db.searchSessions('authentication', projectId);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('searches quests', () => {
    const results = db.searchQuests('migration');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('searches data', () => {
    const results = db.searchData('authentication', projectId);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for no matches', () => {
    const results = db.searchSessions('xyznonexistentxyz', projectId);
    expect(results).toHaveLength(0);
  });
});

// ==================== wyrm_stats ====================

describe('wyrm_stats (getStats)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('returns comprehensive stats', () => {
    const p = db.registerProject('stats-proj', '/stats-proj');
    db.createSession(p.id, { objectives: 'test' });
    db.addQuest(p.id, 'quest');
    db.insertData(p.id, 'cat', 'key', 'val');

    const stats = db.getStats();
    expect(stats.projects).toBe(1);
    expect(stats.sessions).toBe(1);
    expect(stats.quests).toBe(1);
    expect(stats.dataPoints).toBe(1);
    expect(stats.dbSize).toContain('MB');
    expect(stats.totalTokens).toBeGreaterThanOrEqual(0);
  });
});

// ==================== wyrm_maintenance ====================

describe('wyrm_maintenance (vacuum, archiveOldSessions, checkpoint)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('vacuum runs without error', () => {
    expect(() => db.vacuum()).not.toThrow();
  });

  it('checkpoint runs without error', () => {
    expect(() => db.checkpoint()).not.toThrow();
  });

  it('archives old sessions across projects', () => {
    const p = db.registerProject('maint', '/maint').id;
    for (let i = 0; i < 20; i++) {
      db.createSession(p, { objectives: `Session ${i}` });
    }
    const archived = db.archiveOldSessions(p, 5);
    expect(archived).toBe(15);
  });
});

// ==================== wyrm_set_global ====================

describe('wyrm_set_global (setGlobalContext)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('sets and retrieves global context', () => {
    db.setGlobalContext('theme', 'dark');
    expect(db.getGlobalContext('theme')).toBe('dark');
  });

  it('overwrites existing global context', () => {
    db.setGlobalContext('key', 'v1');
    db.setGlobalContext('key', 'v2');
    expect(db.getGlobalContext('key')).toBe('v2');
  });
});

// ==================== wyrm_usage ====================

describe('wyrm_usage (getProjectStats)', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('returns project-level stats', () => {
    const p = db.registerProject('usage-proj', '/usage-proj');
    db.createSession(p.id, { objectives: 'work' });
    db.addQuest(p.id, 'task');
    const completedQ = db.addQuest(p.id, 'done task');
    db.updateQuest(completedQ.id, 'completed');
    db.insertData(p.id, 'cat', 'k', 'v');

    const stats = db.getProjectStats(p.id);
    expect(stats.sessions).toBe(1);
    expect(stats.quests.pending).toBe(1);
    expect(stats.quests.completed).toBe(1);
    expect(stats.dataPoints).toBe(1);
  });
});
