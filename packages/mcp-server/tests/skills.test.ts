/**
 * Skill management tests — register, list, get, delete, activate, deactivate, search, stats
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import { WyrmDB } from '../src/database.js';
import type { Skill } from '../src/database.js';

const TEST_DB_DIR = join(process.cwd(), '.test-dbs-skills');
let dbCounter = 0;

function createTestDB(): WyrmDB {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  return new WyrmDB(join(TEST_DB_DIR, `skills-${process.pid}-${++dbCounter}.db`));
}

afterAll(() => {
  try {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

// ==================== wyrm_skill_register ====================

describe('wyrm_skill_register', () => {
  let db: WyrmDB;

  beforeEach(() => { db = createTestDB(); });
  afterEach(() => { db?.close(); });

  it('registers a new skill', () => {
    const skill = db.registerSkill(
      'web-scraping',
      'Professional web scraping skill',
      '/home/user/.copilot/skills/web-scraping',
      'data-extraction',
      'Ghost Protocol',
      '1.0.0',
      'scraping,web,data'
    );
    expect(skill).toBeDefined();
    expect(skill.name).toBe('web-scraping');
    expect(skill.description).toBe('Professional web scraping skill');
    expect(skill.skill_path).toBe('/home/user/.copilot/skills/web-scraping');
    expect(skill.category).toBe('data-extraction');
    expect(skill.author).toBe('Ghost Protocol');
    expect(skill.version).toBe('1.0.0');
    expect(skill.tags).toBe('scraping,web,data');
    expect(skill.is_active).toBeTruthy();
    expect(skill.usage_count).toBe(0);
  });

  it('registers a skill with minimal fields', () => {
    const skill = db.registerSkill('minimal', 'A minimal skill', '/path/to/skill');
    expect(skill.name).toBe('minimal');
    expect(skill.category).toBeNull();
    expect(skill.author).toBeNull();
    expect(skill.version).toBeNull();
    expect(skill.tags).toBeNull();
  });

  it('upserts on conflicting name', () => {
    db.registerSkill('dup-skill', 'Version 1', '/path/v1');
    const updated = db.registerSkill('dup-skill', 'Version 2', '/path/v2', 'testing');
    expect(updated.description).toBe('Version 2');
    expect(updated.skill_path).toBe('/path/v2');
    expect(updated.category).toBe('testing');
  });
});

// ==================== wyrm_skill_list ====================

describe('wyrm_skill_list', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('skill-a', 'Skill A desc', '/a', 'testing');
    db.registerSkill('skill-b', 'Skill B desc', '/b', 'docs');
    db.registerSkill('skill-c', 'Skill C desc', '/c', 'testing');
  });
  afterEach(() => { db?.close(); });

  it('lists all skills', () => {
    const skills = db.listSkills();
    expect(skills.length).toBe(3);
  });

  it('filters by active status', () => {
    db.deactivateSkill('skill-b');
    const active = db.listSkills(true);
    expect(active.length).toBe(2);
    const inactive = db.listSkills(false);
    expect(inactive.length).toBe(1);
    expect(inactive[0].name).toBe('skill-b');
  });

  it('filters by category', () => {
    const testing = db.listSkills(undefined, 'testing');
    expect(testing.length).toBe(2);
    const docs = db.listSkills(undefined, 'docs');
    expect(docs.length).toBe(1);
  });
});

// ==================== wyrm_skill_get ====================

describe('wyrm_skill_get', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('test-skill', 'Test description', '/test-path', 'testing');
  });
  afterEach(() => { db?.close(); });

  it('retrieves a skill by name', () => {
    const skill = db.getSkill('test-skill');
    expect(skill).toBeDefined();
    expect(skill!.name).toBe('test-skill');
    expect(skill!.description).toBe('Test description');
  });

  it('increments usage_count on each get', () => {
    // First get registers one usage; second get returns 1 and increments
    const s1 = db.getSkill('test-skill');
    // The usage_count returned is the value BEFORE the increment for this call
    // After 3 gets, usage_count should be at least 2 (incremented after fetch)
    db.getSkill('test-skill');
    const skill = db.getSkill('test-skill');
    expect(skill!.usage_count).toBeGreaterThanOrEqual(2);
  });

  it('returns undefined for non-existent skill', () => {
    expect(db.getSkill('no-such-skill')).toBeUndefined();
  });
});

// ==================== wyrm_skill_delete ====================

describe('wyrm_skill_delete', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('deletable', 'To be deleted', '/del');
  });
  afterEach(() => { db?.close(); });

  it('deletes an existing skill', () => {
    const result = db.deleteSkill('deletable');
    expect(result).toBe(true);
    expect(db.getSkill('deletable')).toBeUndefined();
  });

  it('returns false for non-existent skill', () => {
    const result = db.deleteSkill('ghost-skill');
    expect(result).toBe(false);
  });
});

// ==================== wyrm_skill_activate / wyrm_skill_deactivate ====================

describe('wyrm_skill_activate / wyrm_skill_deactivate', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('toggle-skill', 'Toggleable', '/toggle');
  });
  afterEach(() => { db?.close(); });

  it('deactivates a skill', () => {
    const skill = db.deactivateSkill('toggle-skill');
    expect(skill).toBeDefined();
    expect(skill!.is_active).toBeFalsy();
  });

  it('activates a deactivated skill', () => {
    db.deactivateSkill('toggle-skill');
    const skill = db.activateSkill('toggle-skill');
    expect(skill).toBeDefined();
    expect(skill!.is_active).toBeTruthy();
  });

  it('returns undefined for non-existent skill', () => {
    expect(db.activateSkill('nope')).toBeUndefined();
    expect(db.deactivateSkill('nope')).toBeUndefined();
  });
});

// ==================== wyrm_skill_search ====================

describe('wyrm_skill_search', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('web-scraper', 'Scrape websites for data', '/ws', 'data', undefined, undefined, 'scraping,automation');
    db.registerSkill('api-tester', 'Test REST APIs', '/at', 'testing', undefined, undefined, 'api,testing');
    db.registerSkill('doc-generator', 'Generate documentation', '/dg', 'docs', undefined, undefined, 'docs,markdown');
  });
  afterEach(() => { db?.close(); });

  it('searches skills by name', () => {
    const results = db.searchSkills('scraper');
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].name).toBe('web-scraper');
  });

  it('searches skills by description', () => {
    const results = db.searchSkills('documentation');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('searches skills by tags', () => {
    const results = db.searchSkills('automation');
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it('returns empty for no matches', () => {
    const results = db.searchSkills('xyznonexistentxyz');
    expect(results).toHaveLength(0);
  });

  it('respects limit', () => {
    const results = db.searchSkills('scraper OR tester OR generator', 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });
});

// ==================== wyrm_skill_stats ====================

describe('wyrm_skill_stats', () => {
  let db: WyrmDB;

  beforeEach(() => {
    db = createTestDB();
    db.registerSkill('s1', 'Skill 1', '/s1', 'testing');
    db.registerSkill('s2', 'Skill 2', '/s2', 'testing');
    db.registerSkill('s3', 'Skill 3', '/s3', 'docs');
    db.deactivateSkill('s3');
  });
  afterEach(() => { db?.close(); });

  it('returns total, active, and by-category counts', () => {
    const stats = db.getSkillStats();
    expect(stats.total).toBe(3);
    expect(stats.active).toBe(2);
    expect(stats.byCategory.testing).toBe(2);
    expect(stats.byCategory.docs).toBe(1);
  });

  it('returns empty stats on fresh db', () => {
    const freshDb = createTestDB();
    const stats = freshDb.getSkillStats();
    expect(stats.total).toBe(0);
    expect(stats.active).toBe(0);
    expect(Object.keys(stats.byCategory)).toHaveLength(0);
    freshDb.close();
  });
});
