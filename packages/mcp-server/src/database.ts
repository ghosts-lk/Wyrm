/**
 * Wyrm Database - SQLite storage for infinite memory with data lake support
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * 
 * Features:
 * - Auto-discovers projects in configured directories
 * - Handles large datasets with pagination and streaming
 * - Write-Ahead Logging (WAL) for concurrent performance
 * - Full-text search for fast context retrieval
 * - Batch operations for bulk imports
 * - Resilient operations with automatic recovery
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, basename, resolve, normalize, sep } from 'path';
import { spawnSync } from 'child_process';
import { ResilienceManager, getResilienceManager } from './resilience.js';
import { WyrmLogger } from './logger.js';

export interface Project {
  id: number;
  name: string;
  path: string;
  repo?: string;
  stack?: string;
  last_commit?: string;
  branch?: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  project_id: number;
  date: string;
  objectives: string;
  completed: string;
  issues: string;
  commits: string;
  files_changed: string;
  notes: string;
  summary?: string;
  tokens_estimate?: number;
  is_archived: boolean;
}

export interface Quest {
  id: number;
  project_id: number;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
  tags?: string;
  created_at: string;
  completed_at?: string;
}

export interface Context {
  id: number;
  project_id: number;
  key: string;
  value: string;
  updated_at: string;
}

export interface DataPoint {
  id: number;
  project_id: number;
  category: string;
  key: string;
  value: string;
  metadata?: string;
  created_at: string;
}

export interface WatchDir {
  id: number;
  path: string;
  recursive: boolean;
  last_scan: string;
}

export interface Skill {
  id: number;
  name: string;
  description: string;
  skill_path: string;
  category?: string;
  author?: string;
  version?: string;
  tags?: string;
  is_active: boolean;
  usage_count: number;
  last_used?: string;
  created_at: string;
  updated_at: string;
}

export class WyrmDB {
  private db: Database.Database;
  private readonly BATCH_SIZE = 1000;
  private resilience: ResilienceManager;
  private logger: WyrmLogger;
  private dbPath: string;
  
  constructor(dbPath?: string) {
    const wyrmDir = join(homedir(), '.wyrm');
    if (!existsSync(wyrmDir)) {
      mkdirSync(wyrmDir, { recursive: true });
    }
    
    this.dbPath = dbPath || join(wyrmDir, 'wyrm.db');
    this.logger = new WyrmLogger();
    this.resilience = getResilienceManager();
    
    // Initialize database with resilience
    this.db = this.initializeDatabase(this.dbPath);
    
    // Enable WAL mode for better concurrent performance and crash recovery
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');
    this.db.pragma('busy_timeout = 5000'); // Wait 5s for locks
    this.db.pragma('mmap_size = 268435456'); // 256MB memory-mapped I/O
    this.db.pragma('page_size = 4096'); // Optimal page size
    
    this.init();
    
    // Recover any incomplete operations from previous session
    this.recoverIncompleteOperations();
  }
  
  /** Expose the raw database instance for analytics and other modules */
  getDatabase(): Database.Database {
    return this.db;
  }
  
  /** Get the database file path */
  getDatabasePath(): string {
    return this.dbPath;
  }
  
  /**
   * Initialize database with retry logic for handling corruption/locks
   */
  private initializeDatabase(path: string): Database.Database {
    const result = this.resilience.withRetrySync(
      () => new Database(path),
      'database_init',
      { maxAttempts: 3, baseDelayMs: 500 }
    );
    
    if (!result.success) {
      this.logger.error('Failed to initialize database', { path, error: result.error?.message });
      throw result.error || new Error('Database initialization failed');
    }
    
    return result.data!;
  }
  
  /**
   * Recover incomplete operations from previous session
   */
  private recoverIncompleteOperations(): void {
    const incomplete = this.resilience.getIncompleteOperations();
    
    for (const op of incomplete) {
      this.logger.warn('Found incomplete operation from previous session', {
        operation: op.operation,
        stage: op.stage,
        id: op.id,
      });
      
      // For now, just log - specific recovery logic can be added
      // based on operation type
      if (op.operation === 'batch_insert') {
        this.logger.info('Batch insert was incomplete - data may need re-import');
      }
      
      // Mark as handled
      this.resilience.completeCheckpoint(op.id);
    }
  }
  
  private init() {
    this.db.exec(`
      -- Core tables
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        repo TEXT,
        stack TEXT,
        last_commit TEXT,
        branch TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        date TEXT NOT NULL,
        objectives TEXT,
        completed TEXT,
        issues TEXT,
        commits TEXT,
        files_changed TEXT,
        notes TEXT,
        summary TEXT,
        tokens_estimate INTEGER DEFAULT 0,
        is_archived INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        tags TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(project_id, key),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      
      -- Data lake tables for large datasets
      CREATE TABLE IF NOT EXISTS data_lake (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        category TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );
      
      -- Watch directories for auto-discovery
      CREATE TABLE IF NOT EXISTS watch_dirs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT UNIQUE NOT NULL,
        recursive INTEGER DEFAULT 1,
        last_scan TEXT
      );
      
      -- Global context (cross-project)
      CREATE TABLE IF NOT EXISTS global_context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT UNIQUE NOT NULL,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      -- Skills management for Copilot skill integration
      CREATE TABLE IF NOT EXISTS skills (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT UNIQUE NOT NULL,
        description TEXT,
        skill_path TEXT NOT NULL,
        category TEXT,
        author TEXT,
        version TEXT,
        tags TEXT,
        is_active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        last_used TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );
      
      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
      CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(is_archived);
      CREATE INDEX IF NOT EXISTS idx_quests_project ON quests(project_id);
      CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
      CREATE INDEX IF NOT EXISTS idx_quests_priority ON quests(priority);
      CREATE INDEX IF NOT EXISTS idx_context_project ON context(project_id);
      CREATE INDEX IF NOT EXISTS idx_data_lake_project ON data_lake(project_id);
      CREATE INDEX IF NOT EXISTS idx_data_lake_category ON data_lake(category);
      CREATE INDEX IF NOT EXISTS idx_data_lake_key ON data_lake(key);
      CREATE INDEX IF NOT EXISTS idx_skills_name ON skills(name);
      CREATE INDEX IF NOT EXISTS idx_skills_category ON skills(category);
      CREATE INDEX IF NOT EXISTS idx_skills_active ON skills(is_active);
      
      -- Full-text search for fast queries
      CREATE VIRTUAL TABLE IF NOT EXISTS sessions_fts USING fts5(
        objectives, completed, issues, notes, summary,
        content='sessions', content_rowid='id'
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS quests_fts USING fts5(
        title, description,
        content='quests', content_rowid='id'
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS data_lake_fts USING fts5(
        key, value,
        content='data_lake', content_rowid='id'
      );
      
      CREATE VIRTUAL TABLE IF NOT EXISTS skills_fts USING fts5(
        name, description, tags,
        content='skills', content_rowid='id'
      );
      
      -- Triggers to keep FTS in sync
      CREATE TRIGGER IF NOT EXISTS sessions_ai AFTER INSERT ON sessions BEGIN
        INSERT INTO sessions_fts(rowid, objectives, completed, issues, notes, summary)
        VALUES (new.id, new.objectives, new.completed, new.issues, new.notes, new.summary);
      END;
      
      CREATE TRIGGER IF NOT EXISTS sessions_ad AFTER DELETE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, objectives, completed, issues, notes, summary)
        VALUES('delete', old.id, old.objectives, old.completed, old.issues, old.notes, old.summary);
      END;
      
      CREATE TRIGGER IF NOT EXISTS quests_ai AFTER INSERT ON quests BEGIN
        INSERT INTO quests_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;
      
      CREATE TRIGGER IF NOT EXISTS quests_ad AFTER DELETE ON quests BEGIN
        INSERT INTO quests_fts(quests_fts, rowid, title, description)
        VALUES('delete', old.id, old.title, old.description);
      END;
      
      CREATE TRIGGER IF NOT EXISTS skills_ai AFTER INSERT ON skills BEGIN
        INSERT INTO skills_fts(rowid, name, description, tags) VALUES (new.id, new.name, new.description, new.tags);
      END;
      
      CREATE TRIGGER IF NOT EXISTS skills_ad AFTER DELETE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES('delete', old.id, old.name, old.description, old.tags);
      END;

      -- UPDATE triggers to keep FTS in sync on updates
      CREATE TRIGGER IF NOT EXISTS sessions_au AFTER UPDATE ON sessions BEGIN
        INSERT INTO sessions_fts(sessions_fts, rowid, objectives, completed, issues, notes, summary)
        VALUES('delete', old.id, old.objectives, old.completed, old.issues, old.notes, old.summary);
        INSERT INTO sessions_fts(rowid, objectives, completed, issues, notes, summary)
        VALUES (new.id, new.objectives, new.completed, new.issues, new.notes, new.summary);
      END;

      CREATE TRIGGER IF NOT EXISTS quests_au AFTER UPDATE ON quests BEGIN
        INSERT INTO quests_fts(quests_fts, rowid, title, description)
        VALUES('delete', old.id, old.title, old.description);
        INSERT INTO quests_fts(rowid, title, description) VALUES (new.id, new.title, new.description);
      END;

      CREATE TRIGGER IF NOT EXISTS skills_au AFTER UPDATE ON skills BEGIN
        INSERT INTO skills_fts(skills_fts, rowid, name, description, tags)
        VALUES('delete', old.id, old.name, old.description, old.tags);
        INSERT INTO skills_fts(rowid, name, description, tags) VALUES (new.id, new.name, new.description, new.tags);
      END;

      -- data_lake FTS triggers (were missing entirely)
      CREATE TRIGGER IF NOT EXISTS data_lake_ai AFTER INSERT ON data_lake BEGIN
        INSERT INTO data_lake_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;

      CREATE TRIGGER IF NOT EXISTS data_lake_ad AFTER DELETE ON data_lake BEGIN
        INSERT INTO data_lake_fts(data_lake_fts, rowid, key, value)
        VALUES('delete', old.id, old.key, old.value);
      END;

      CREATE TRIGGER IF NOT EXISTS data_lake_au AFTER UPDATE ON data_lake BEGIN
        INSERT INTO data_lake_fts(data_lake_fts, rowid, key, value)
        VALUES('delete', old.id, old.key, old.value);
        INSERT INTO data_lake_fts(rowid, key, value) VALUES (new.id, new.key, new.value);
      END;
    `);
  }
  
  // ==================== WATCH DIRECTORIES ====================
  
  addWatchDir(path: string, recursive = true): WatchDir {
    return this.db.prepare(`
      INSERT INTO watch_dirs (path, recursive)
      VALUES (?, ?)
      ON CONFLICT(path) DO UPDATE SET recursive = excluded.recursive
      RETURNING *
    `).get(path, recursive ? 1 : 0) as WatchDir;
  }
  
  getWatchDirs(): WatchDir[] {
    return this.db.prepare('SELECT * FROM watch_dirs').all() as WatchDir[];
  }
  
  removeWatchDir(path: string): void {
    this.db.prepare('DELETE FROM watch_dirs WHERE path = ?').run(path);
  }
  
  // ==================== AUTO-DISCOVERY ====================
  
  scanForProjects(rootPath: string, recursive = true): Project[] {
    const discovered: Project[] = [];
    
    const scan = (dir: string, depth = 0) => {
      if (depth > 3 && recursive) return; // Max 3 levels deep
      
      try {
        const entries = readdirSync(dir, { withFileTypes: true });
        
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (entry.name.startsWith('.') && entry.name !== '.git') continue;
          
          const fullPath = join(dir, entry.name);
          
          // Check if it's a git repo
          const gitDir = join(fullPath, '.git');
          if (existsSync(gitDir)) {
            const project = this.registerProjectFromPath(fullPath);
            if (project) discovered.push(project);
          } else if (recursive && depth < 3) {
            scan(fullPath, depth + 1);
          }
        }
      } catch {
        // Skip inaccessible directories
      }
    };
    
    scan(rootPath);
    
    // Update last scan time
    this.db.prepare(`
      UPDATE watch_dirs SET last_scan = datetime('now') WHERE path = ?
    `).run(rootPath);
    
    return discovered;
  }
  
  scanAllWatchDirs(): Project[] {
    const dirs = this.getWatchDirs();
    const all: Project[] = [];
    
    for (const dir of dirs) {
      const found = this.scanForProjects(dir.path, !!dir.recursive);
      all.push(...found);
    }
    
    return all;
  }
  
  private registerProjectFromPath(projectPath: string): Project | null {
    try {
      // SECURITY: Validate path is a real directory before any operations
      const normalizedPath = normalize(resolve(projectPath));
      if (!existsSync(normalizedPath) || !statSync(normalizedPath).isDirectory()) {
        return null;
      }
      
      const name = basename(normalizedPath);
      let repo: string | undefined;
      let branch: string | undefined;
      let lastCommit: string | undefined;
      let stack: string | undefined;
      
      try {
        // SECURITY: Use spawnSync with shell: false to prevent command injection
        const repoResult = spawnSync('git', ['config', '--get', 'remote.origin.url'], { 
          cwd: normalizedPath, 
          encoding: 'utf-8',
          timeout: 5000,
          shell: false  // CRITICAL: No shell interpretation
        });
        if (repoResult.status === 0) {
          repo = repoResult.stdout.trim();
        }
        
        const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
          cwd: normalizedPath,
          encoding: 'utf-8',
          timeout: 5000,
          shell: false
        });
        if (branchResult.status === 0) {
          branch = branchResult.stdout.trim();
        }
        
        const commitResult = spawnSync('git', ['log', '-1', '--format=%h %s'], {
          cwd: normalizedPath,
          encoding: 'utf-8',
          timeout: 5000,
          shell: false
        });
        if (commitResult.status === 0) {
          lastCommit = commitResult.stdout.trim();
        }
      } catch {
        // Not a git repo or git not available
      }
      
      // Detect stack
      if (existsSync(join(normalizedPath, 'package.json'))) {
        stack = 'Node.js';
        if (existsSync(join(normalizedPath, 'next.config.js')) || 
            existsSync(join(normalizedPath, 'next.config.ts')) ||
            existsSync(join(normalizedPath, 'next.config.mjs'))) {
          stack = 'Next.js';
        } else if (existsSync(join(normalizedPath, 'vite.config.ts'))) {
          stack = 'Vite';
        }
      } else if (existsSync(join(normalizedPath, 'requirements.txt')) || 
                 existsSync(join(normalizedPath, 'pyproject.toml'))) {
        stack = 'Python';
      } else if (existsSync(join(normalizedPath, 'composer.json'))) {
        stack = 'PHP';
      } else if (existsSync(join(normalizedPath, 'Cargo.toml'))) {
        stack = 'Rust';
      } else if (existsSync(join(normalizedPath, 'go.mod'))) {
        stack = 'Go';
      }
      
      return this.registerProject(name, normalizedPath, repo, stack, lastCommit, branch);
    } catch {
      return null;
    }
  }
  
  // ==================== PROJECTS ====================
  
  registerProject(
    name: string, 
    path: string, 
    repo?: string, 
    stack?: string,
    lastCommit?: string,
    branch?: string
  ): Project {
    const stmt = this.db.prepare(`
      INSERT INTO projects (name, path, repo, stack, last_commit, branch)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        repo = COALESCE(excluded.repo, projects.repo),
        stack = COALESCE(excluded.stack, projects.stack),
        last_commit = COALESCE(excluded.last_commit, projects.last_commit),
        branch = COALESCE(excluded.branch, projects.branch),
        updated_at = datetime('now')
      RETURNING *
    `);
    return stmt.get(name, path, repo || null, stack || null, lastCommit || null, branch || null) as Project;
  }
  
  getProject(path: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | undefined;
  }
  
  getProjectById(id: number): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }
  
  getProjectByName(name: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE name = ?').get(name) as Project | undefined;
  }
  
  getAllProjects(limit = 100, offset = 0): Project[] {
    return this.db.prepare(`
      SELECT * FROM projects ORDER BY updated_at DESC LIMIT ? OFFSET ?
    `).all(limit, offset) as Project[];
  }
  
  searchProjects(query: string): Project[] {
    const pattern = `%${query}%`;
    return this.db.prepare(`
      SELECT * FROM projects 
      WHERE name LIKE ? OR stack LIKE ? OR repo LIKE ?
      ORDER BY updated_at DESC
      LIMIT 50
    `).all(pattern, pattern, pattern) as Project[];
  }
  
  // ==================== SESSIONS ====================
  
  createSession(projectId: number, data: Partial<Session>): Session {
    const tokensEstimate = this.estimateTokens(
      (data.objectives || '') + (data.completed || '') + (data.issues || '') + (data.notes || '')
    );
    
    const result = this.resilience.withRetrySync(
      () => {
        const stmt = this.db.prepare(`
          INSERT INTO sessions (project_id, date, objectives, completed, issues, commits, files_changed, notes, tokens_estimate)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
          RETURNING *
        `);
        return stmt.get(
          projectId,
          data.date || new Date().toISOString().split('T')[0],
          data.objectives || '',
          data.completed || '',
          data.issues || '',
          data.commits || '',
          data.files_changed || '',
          data.notes || '',
          tokensEstimate
        ) as Session;
      },
      'createSession'
    );
    
    if (!result.success) {
      throw result.error || new Error('Failed to create session');
    }
    
    return result.data!;
  }
  
  updateSession(id: number, data: Partial<Session>): Session {
    const updates: string[] = [];
    const values: unknown[] = [];
    
    for (const [key, value] of Object.entries(data)) {
      if (key !== 'id' && key !== 'project_id' && key !== 'created_at') {
        updates.push(`${key} = ?`);
        values.push(value);
      }
    }
    
    if (updates.length === 0) return this.getSession(id)!;
    
    // Recalculate tokens if content changed
    if (data.objectives || data.completed || data.issues || data.notes) {
      const session = this.getSession(id);
      if (session) {
        const newTokens = this.estimateTokens(
          (data.objectives || session.objectives) +
          (data.completed || session.completed) +
          (data.issues || session.issues) +
          (data.notes || session.notes)
        );
        updates.push('tokens_estimate = ?');
        values.push(newTokens);
      }
    }
    
    values.push(id);
    
    const result = this.resilience.withRetrySync(
      () => {
        const stmt = this.db.prepare(`
          UPDATE sessions SET ${updates.join(', ')} WHERE id = ? RETURNING *
        `);
        return stmt.get(...values) as Session;
      },
      'updateSession'
    );
    
    if (!result.success) {
      throw result.error || new Error('Failed to update session');
    }
    
    return result.data!;
  }
  
  getSession(id: number): Session | undefined {
    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as Session | undefined;
  }
  
  getRecentSessions(projectId: number, limit = 5): Session[] {
    return this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ? AND is_archived = 0
      ORDER BY date DESC, id DESC
      LIMIT ?
    `).all(projectId, limit) as Session[];
  }
  
  getTodaySession(projectId: number): Session | undefined {
    const today = new Date().toISOString().split('T')[0];
    return this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? AND date = ?
    `).get(projectId, today) as Session | undefined;
  }
  
  searchSessions(query: string, projectId?: number): Session[] {
    if (projectId) {
      return this.db.prepare(`
        SELECT s.* FROM sessions s
        JOIN sessions_fts fts ON s.id = fts.rowid
        WHERE sessions_fts MATCH ? AND s.project_id = ?
        ORDER BY s.date DESC
        LIMIT 50
      `).all(query, projectId) as Session[];
    }
    
    return this.db.prepare(`
      SELECT s.* FROM sessions s
      JOIN sessions_fts fts ON s.id = fts.rowid
      WHERE sessions_fts MATCH ?
      ORDER BY s.date DESC
      LIMIT 50
    `).all(query) as Session[];
  }
  
  archiveOldSessions(projectId: number, keepRecent = 10): number {
    const result = this.db.prepare(`
      UPDATE sessions 
      SET is_archived = 1
      WHERE project_id = ? 
        AND is_archived = 0
        AND id NOT IN (
          SELECT id FROM sessions 
          WHERE project_id = ? 
          ORDER BY date DESC, id DESC 
          LIMIT ?
        )
    `).run(projectId, projectId, keepRecent);
    return result.changes;
  }
  
  getSessionTokenUsage(projectId: number): number {
    const result = this.db.prepare(`
      SELECT COALESCE(SUM(tokens_estimate), 0) as total
      FROM sessions WHERE project_id = ? AND is_archived = 0
    `).get(projectId) as { total: number };
    return result.total;
  }
  
  // ==================== QUESTS ====================
  
  addQuest(projectId: number, title: string, description?: string, priority: Quest['priority'] = 'medium', tags?: string): Quest {
    return this.db.prepare(`
      INSERT INTO quests (project_id, title, description, priority, tags)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).get(projectId, title, description || '', priority, tags || null) as Quest;
  }
  
  updateQuest(id: number, status: Quest['status']): Quest {
    const completedAt = status === 'completed' ? new Date().toISOString() : null;
    return this.db.prepare(`
      UPDATE quests SET status = ?, completed_at = ? WHERE id = ? RETURNING *
    `).get(status, completedAt, id) as Quest;
  }
  
  getPendingQuests(projectId: number): Quest[] {
    return this.db.prepare(`
      SELECT * FROM quests 
      WHERE project_id = ? AND status IN ('pending', 'in_progress')
      ORDER BY 
        CASE priority 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
        END,
        created_at ASC
    `).all(projectId) as Quest[];
  }
  
  getAllPendingQuests(): Quest[] {
    return this.db.prepare(`
      SELECT q.*, p.name as project_name FROM quests q
      JOIN projects p ON q.project_id = p.id
      WHERE q.status IN ('pending', 'in_progress')
      ORDER BY 
        CASE q.priority 
          WHEN 'critical' THEN 1 
          WHEN 'high' THEN 2 
          WHEN 'medium' THEN 3 
          WHEN 'low' THEN 4 
        END,
        q.created_at ASC
    `).all() as (Quest & { project_name: string })[];
  }
  
  searchQuests(query: string): Quest[] {
    return this.db.prepare(`
      SELECT q.* FROM quests q
      JOIN quests_fts fts ON q.id = fts.rowid
      WHERE quests_fts MATCH ?
      ORDER BY q.created_at DESC
      LIMIT 50
    `).all(query) as Quest[];
  }
  
  getRecentlyCompleted(projectId: number, limit = 5): Quest[] {
    return this.db.prepare(`
      SELECT * FROM quests 
      WHERE project_id = ? AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(projectId, limit) as Quest[];
  }
  
  // ==================== CONTEXT ====================
  
  setContext(projectId: number, key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO context (project_id, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id, key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `).run(projectId, key, value);
  }
  
  getContext(projectId: number, key: string): string | undefined {
    const row = this.db.prepare(`
      SELECT value FROM context WHERE project_id = ? AND key = ?
    `).get(projectId, key) as { value: string } | undefined;
    return row?.value;
  }
  
  getAllContext(projectId: number): Record<string, string> {
    const rows = this.db.prepare(`
      SELECT key, value FROM context WHERE project_id = ?
    `).all(projectId) as { key: string; value: string }[];
    
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
  
  // ==================== GLOBAL CONTEXT ====================
  
  setGlobalContext(key: string, value: string): void {
    this.db.prepare(`
      INSERT INTO global_context (key, value)
      VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = datetime('now')
    `).run(key, value);
  }
  
  getGlobalContext(key: string): string | undefined {
    const row = this.db.prepare(`
      SELECT value FROM global_context WHERE key = ?
    `).get(key) as { value: string } | undefined;
    return row?.value;
  }
  
  getAllGlobalContext(): Record<string, string> {
    const rows = this.db.prepare('SELECT key, value FROM global_context').all() as { key: string; value: string }[];
    const result: Record<string, string> = {};
    for (const row of rows) {
      result[row.key] = row.value;
    }
    return result;
  }
  
  // ==================== SKILLS MANAGEMENT ====================
  
  registerSkill(name: string, description: string, skillPath: string, category?: string, author?: string, version?: string, tags?: string): Skill {
    const result = this.resilience.withRetrySync(
      () => this.db.prepare(`
        INSERT INTO skills (name, description, skill_path, category, author, version, tags, is_active, usage_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, 0)
        ON CONFLICT(name) DO UPDATE SET
          description = excluded.description,
          skill_path = excluded.skill_path,
          category = excluded.category,
          author = excluded.author,
          version = excluded.version,
          tags = excluded.tags,
          updated_at = datetime('now'),
          is_active = 1
        RETURNING *
      `).get(name, description, skillPath, category || null, author || null, version || null, tags || null) as Skill,
      'registerSkill'
    );
    
    if (!result.success) {
      throw result.error || new Error('Failed to register skill');
    }
    
    return result.data!;
  }
  
  getSkill(name: string): Skill | undefined {
    const skill = this.db.prepare('SELECT * FROM skills WHERE name = ?').get(name) as Skill | undefined;
    if (skill) {
      // Update last_used
      this.db.prepare('UPDATE skills SET last_used = datetime(\'now\'), usage_count = usage_count + 1 WHERE id = ?').run(skill.id);
    }
    return skill;
  }
  
  listSkills(active?: boolean, category?: string, search?: string): Skill[] {
    let query = 'SELECT * FROM skills WHERE 1=1';
    const params: any[] = [];
    
    if (active !== undefined) {
      query += ' AND is_active = ?';
      params.push(active ? 1 : 0);
    }
    
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    
    if (search) {
      query += ' AND id IN (SELECT rowid FROM skills_fts WHERE skills_fts MATCH ?)';
      params.push(search);
    }
    
    query += ' ORDER BY updated_at DESC';
    
    return this.db.prepare(query).all(...params) as Skill[];
  }
  
  searchSkills(query: string, limit = 20): Skill[] {
    return this.db.prepare(`
      SELECT s.* FROM skills s
      JOIN skills_fts ON s.id = skills_fts.rowid
      WHERE skills_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `).all(query, limit) as Skill[];
  }
  
  updateSkill(name: string, updates: Partial<Skill>): Skill | undefined {
    const setClauses: string[] = [];
    const values: any[] = [];
    
    if (updates.description !== undefined) {
      setClauses.push('description = ?');
      values.push(updates.description);
    }
    if (updates.skill_path !== undefined) {
      setClauses.push('skill_path = ?');
      values.push(updates.skill_path);
    }
    if (updates.category !== undefined) {
      setClauses.push('category = ?');
      values.push(updates.category);
    }
    if (updates.is_active !== undefined) {
      setClauses.push('is_active = ?');
      values.push(updates.is_active ? 1 : 0);
    }
    if (updates.tags !== undefined) {
      setClauses.push('tags = ?');
      values.push(updates.tags);
    }
    if (updates.version !== undefined) {
      setClauses.push('version = ?');
      values.push(updates.version);
    }
    
    if (setClauses.length === 0) {
      return this.getSkill(name);
    }
    
    setClauses.push('updated_at = datetime(\'now\')');
    values.push(name);
    
    return this.db.prepare(`
      UPDATE skills SET ${setClauses.join(', ')} WHERE name = ? RETURNING *
    `).get(...values) as Skill | undefined;
  }
  
  deleteSkill(name: string): boolean {
    const result = this.db.prepare('DELETE FROM skills WHERE name = ?').run(name);
    return result.changes > 0;
  }
  
  deactivateSkill(name: string): Skill | undefined {
    return this.updateSkill(name, { is_active: false });
  }
  
  activateSkill(name: string): Skill | undefined {
    return this.updateSkill(name, { is_active: true });
  }
  
  getSkillStats(): { total: number; active: number; byCategory: Record<string, number> } {
    const total = (this.db.prepare('SELECT COUNT(*) as count FROM skills').get() as { count: number }).count;
    const active = (this.db.prepare('SELECT COUNT(*) as count FROM skills WHERE is_active = 1').get() as { count: number }).count;
    
    const byCategoryRows = this.db.prepare(`
      SELECT category, COUNT(*) as count FROM skills WHERE category IS NOT NULL GROUP BY category
    `).all() as { category: string; count: number }[];
    
    const byCategory: Record<string, number> = {};
    for (const row of byCategoryRows) {
      byCategory[row.category] = row.count;
    }
    
    return { total, active, byCategory };
  }
  
  // ==================== DATA LAKE ====================
  
  insertData(projectId: number, category: string, key: string, value: string, metadata?: Record<string, unknown>): DataPoint {
    const result = this.resilience.withRetrySync(
      () => this.db.prepare(`
        INSERT INTO data_lake (project_id, category, key, value, metadata)
        VALUES (?, ?, ?, ?, ?)
        RETURNING *
      `).get(projectId, category, key, value, metadata ? JSON.stringify(metadata) : null) as DataPoint,
      'insertData'
    );
    
    if (!result.success) {
      throw result.error || new Error('Insert data failed');
    }
    
    return result.data!;
  }
  
  /**
   * Batch insert with resilience - uses checkpointing for large batches
   */
  insertDataBatch(data: Array<{ projectId: number; category: string; key: string; value: string; metadata?: Record<string, unknown> }>): number {
    const operationId = this.resilience.generateOperationId('batch_insert');
    const batchSize = this.BATCH_SIZE;
    let totalInserted = 0;
    
    // Checkpoint for recovery
    this.resilience.createCheckpoint(operationId, 'batch_insert', 'started', {
      totalItems: data.length,
      batchSize,
    });
    
    const insert = this.db.prepare(`
      INSERT INTO data_lake (project_id, category, key, value, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    try {
      // Process in batches for large datasets
      for (let i = 0; i < data.length; i += batchSize) {
        const batch = data.slice(i, i + batchSize);
        const batchNum = Math.floor(i / batchSize) + 1;
        
        this.resilience.updateCheckpoint(operationId, `batch_${batchNum}`, {
          processed: i,
          currentBatch: batchNum,
        });
        
        // Transaction for each batch
        const result = this.resilience.withRetrySync(
          () => {
            const insertBatch = this.db.transaction((items: typeof batch) => {
              let count = 0;
              for (const item of items) {
                insert.run(
                  item.projectId,
                  item.category,
                  item.key,
                  item.value,
                  item.metadata ? JSON.stringify(item.metadata) : null
                );
                count++;
              }
              return count;
            });
            return insertBatch(batch);
          },
          `batch_insert_${batchNum}`,
          { maxAttempts: 3 }
        );
        
        if (!result.success) {
          this.logger.error('Batch insert failed', {
            batch: batchNum,
            processed: totalInserted,
            error: result.error?.message,
          });
          // Return what was successfully inserted
          this.resilience.updateCheckpoint(operationId, 'partial_failure', {
            inserted: totalInserted,
            failedAt: i,
          });
          return totalInserted;
        }
        
        totalInserted += result.data!;
      }
      
      this.resilience.completeCheckpoint(operationId);
      return totalInserted;
    } catch (error) {
      this.logger.error('Batch insert exception', {
        inserted: totalInserted,
        error: (error as Error).message,
      });
      this.resilience.updateCheckpoint(operationId, 'exception', {
        inserted: totalInserted,
        error: (error as Error).message,
      });
      return totalInserted;
    }
  }
  
  queryData(projectId: number, category?: string, limit = 100, offset = 0): DataPoint[] {
    if (category) {
      return this.db.prepare(`
        SELECT * FROM data_lake 
        WHERE project_id = ? AND category = ?
        ORDER BY created_at DESC
        LIMIT ? OFFSET ?
      `).all(projectId, category, limit, offset) as DataPoint[];
    }
    
    return this.db.prepare(`
      SELECT * FROM data_lake 
      WHERE project_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `).all(projectId, limit, offset) as DataPoint[];
  }
  
  searchData(query: string, projectId?: number): DataPoint[] {
    if (projectId) {
      return this.db.prepare(`
        SELECT d.* FROM data_lake d
        JOIN data_lake_fts fts ON d.id = fts.rowid
        WHERE data_lake_fts MATCH ? AND d.project_id = ?
        ORDER BY d.created_at DESC
        LIMIT 100
      `).all(query, projectId) as DataPoint[];
    }
    
    return this.db.prepare(`
      SELECT d.* FROM data_lake d
      JOIN data_lake_fts fts ON d.id = fts.rowid
      WHERE data_lake_fts MATCH ?
      ORDER BY d.created_at DESC
      LIMIT 100
    `).all(query) as DataPoint[];
  }
  
  getDataCategories(projectId: number): { category: string; count: number }[] {
    return this.db.prepare(`
      SELECT category, COUNT(*) as count 
      FROM data_lake 
      WHERE project_id = ?
      GROUP BY category
      ORDER BY count DESC
    `).all(projectId) as { category: string; count: number }[];
  }
  
  deleteDataCategory(projectId: number, category: string): number {
    const result = this.db.prepare(`
      DELETE FROM data_lake WHERE project_id = ? AND category = ?
    `).run(projectId, category);
    return result.changes;
  }
  
  // ==================== STREAMING ====================
  
  *streamSessions(projectId: number): Generator<Session> {
    const stmt = this.db.prepare(`
      SELECT * FROM sessions WHERE project_id = ? ORDER BY date DESC
    `);
    
    for (const row of stmt.iterate(projectId)) {
      yield row as Session;
    }
  }
  
  *streamData(projectId: number, category?: string): Generator<DataPoint> {
    const stmt = category
      ? this.db.prepare('SELECT * FROM data_lake WHERE project_id = ? AND category = ?')
      : this.db.prepare('SELECT * FROM data_lake WHERE project_id = ?');
    
    const params = category ? [projectId, category] : [projectId];
    
    for (const row of stmt.iterate(...params)) {
      yield row as DataPoint;
    }
  }
  
  // ==================== STATS & UTILITIES ====================
  
  getStats(): { 
    projects: number; 
    sessions: number; 
    quests: number;
    dataPoints: number;
    totalTokens: number;
    dbSize: string;
  } {
    const projects = this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const quests = this.db.prepare('SELECT COUNT(*) as count FROM quests').get() as { count: number };
    const dataPoints = this.db.prepare('SELECT COUNT(*) as count FROM data_lake').get() as { count: number };
    const tokens = this.db.prepare('SELECT COALESCE(SUM(tokens_estimate), 0) as total FROM sessions WHERE is_archived = 0').get() as { total: number };
    const pageCount = this.db.pragma('page_count', { simple: true }) as number;
    const pageSize = this.db.pragma('page_size', { simple: true }) as number;
    const dbSize = (pageCount * pageSize) / (1024 * 1024);
    
    return {
      projects: projects.count,
      sessions: sessions.count,
      quests: quests.count,
      dataPoints: dataPoints.count,
      totalTokens: tokens.total,
      dbSize: `${dbSize.toFixed(2)} MB`
    };
  }
  
  getProjectStats(projectId: number): {
    sessions: number;
    quests: { pending: number; completed: number };
    dataPoints: number;
    tokens: number;
  } {
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions WHERE project_id = ?').get(projectId) as { count: number };
    const pendingQuests = this.db.prepare(`SELECT COUNT(*) as count FROM quests WHERE project_id = ? AND status IN ('pending', 'in_progress')`).get(projectId) as { count: number };
    const completedQuests = this.db.prepare(`SELECT COUNT(*) as count FROM quests WHERE project_id = ? AND status = 'completed'`).get(projectId) as { count: number };
    const dataPoints = this.db.prepare('SELECT COUNT(*) as count FROM data_lake WHERE project_id = ?').get(projectId) as { count: number };
    const tokens = this.db.prepare('SELECT COALESCE(SUM(tokens_estimate), 0) as total FROM sessions WHERE project_id = ? AND is_archived = 0').get(projectId) as { total: number };
    
    return {
      sessions: sessions.count,
      quests: { pending: pendingQuests.count, completed: completedQuests.count },
      dataPoints: dataPoints.count,
      tokens: tokens.total
    };
  }
  
  private estimateTokens(text: string): number {
    // Rough estimate: ~4 chars per token
    return Math.ceil(text.length / 4);
  }
  
  vacuum(): void {
    this.db.exec('VACUUM');
  }
  
  checkpoint(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }
  
  /**
   * Get resilience status for monitoring
   */
  getResilienceStatus(): {
    circuitState: string;
    failures: number;
    incompleteOps: number;
  } {
    const circuit = this.resilience.getCircuitStatus();
    const incomplete = this.resilience.getIncompleteOperations();
    
    return {
      circuitState: circuit.state,
      failures: circuit.failures,
      incompleteOps: incomplete.length,
    };
  }
  
  /**
   * Reset circuit breaker (manual recovery)
   */
  resetCircuitBreaker(): void {
    this.resilience.resetCircuit();
  }
  
  /**
   * Safe close with WAL checkpoint and cleanup
   */
  close(): void {
    try {
      // Checkpoint WAL to ensure all data is persisted
      this.checkpoint();
      this.logger.info('Database checkpoint completed');
    } catch (error) {
      this.logger.error('Checkpoint failed during close', {
        error: (error as Error).message,
      });
    }
    
    try {
      this.db.close();
      this.logger.info('Database closed successfully');
    } catch (error) {
      this.logger.error('Database close failed', {
        error: (error as Error).message,
      });
    }
  }
  
  /**
   * Check database integrity
   */
  checkIntegrity(): { ok: boolean; issues: string[] } {
    const issues: string[] = [];
    
    try {
      const result = this.db.pragma('integrity_check', { simple: true }) as string;
      if (result !== 'ok') {
        issues.push(`Integrity check failed: ${result}`);
      }
    } catch (error) {
      issues.push(`Integrity check error: ${(error as Error).message}`);
    }
    
    try {
      const fk = this.db.pragma('foreign_key_check') as unknown[];
      if (fk.length > 0) {
        issues.push(`Foreign key violations: ${fk.length}`);
      }
    } catch (error) {
      issues.push(`FK check error: ${(error as Error).message}`);
    }
    
    return {
      ok: issues.length === 0,
      issues,
    };
  }
}
