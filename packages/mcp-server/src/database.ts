/**
 * Wyrm Database - SQLite storage for infinite memory with data lake support
 * 
 * Features:
 * - Auto-discovers projects in configured directories
 * - Handles large datasets with pagination and streaming
 * - Write-Ahead Logging (WAL) for concurrent performance
 * - Full-text search for fast context retrieval
 * - Batch operations for bulk imports
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync, readdirSync, statSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { execSync } from 'child_process';

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

export class WyrmDB {
  private db: Database.Database;
  private readonly BATCH_SIZE = 1000;
  
  constructor(dbPath?: string) {
    const wyrmDir = join(homedir(), '.wyrm');
    if (!existsSync(wyrmDir)) {
      mkdirSync(wyrmDir, { recursive: true });
    }
    
    const path = dbPath || join(wyrmDir, 'wyrm.db');
    this.db = new Database(path);
    
    // Enable WAL mode for better concurrent performance
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('cache_size = -64000'); // 64MB cache
    this.db.pragma('temp_store = MEMORY');
    
    this.init();
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
      const name = basename(projectPath);
      let repo: string | undefined;
      let branch: string | undefined;
      let lastCommit: string | undefined;
      let stack: string | undefined;
      
      try {
        repo = execSync('git config --get remote.origin.url', { 
          cwd: projectPath, 
          encoding: 'utf-8',
          timeout: 5000 
        }).trim();
        
        branch = execSync('git rev-parse --abbrev-ref HEAD', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000
        }).trim();
        
        lastCommit = execSync('git log -1 --format="%h %s"', {
          cwd: projectPath,
          encoding: 'utf-8',
          timeout: 5000
        }).trim();
      } catch {
        // Not a git repo or git not available
      }
      
      // Detect stack
      if (existsSync(join(projectPath, 'package.json'))) {
        stack = 'Node.js';
        if (existsSync(join(projectPath, 'next.config.js')) || 
            existsSync(join(projectPath, 'next.config.ts'))) {
          stack = 'Next.js';
        } else if (existsSync(join(projectPath, 'vite.config.ts'))) {
          stack = 'Vite';
        }
      } else if (existsSync(join(projectPath, 'requirements.txt')) || 
                 existsSync(join(projectPath, 'pyproject.toml'))) {
        stack = 'Python';
      } else if (existsSync(join(projectPath, 'composer.json'))) {
        stack = 'PHP';
      } else if (existsSync(join(projectPath, 'Cargo.toml'))) {
        stack = 'Rust';
      } else if (existsSync(join(projectPath, 'go.mod'))) {
        stack = 'Go';
      }
      
      return this.registerProject(name, projectPath, repo, stack, lastCommit, branch);
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
    const stmt = this.db.prepare(`
      UPDATE sessions SET ${updates.join(', ')} WHERE id = ? RETURNING *
    `);
    return stmt.get(...values) as Session;
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
  
  // ==================== DATA LAKE ====================
  
  insertData(projectId: number, category: string, key: string, value: string, metadata?: Record<string, unknown>): DataPoint {
    return this.db.prepare(`
      INSERT INTO data_lake (project_id, category, key, value, metadata)
      VALUES (?, ?, ?, ?, ?)
      RETURNING *
    `).get(projectId, category, key, value, metadata ? JSON.stringify(metadata) : null) as DataPoint;
  }
  
  insertDataBatch(data: Array<{ projectId: number; category: string; key: string; value: string; metadata?: Record<string, unknown> }>): number {
    const insert = this.db.prepare(`
      INSERT INTO data_lake (project_id, category, key, value, metadata)
      VALUES (?, ?, ?, ?, ?)
    `);
    
    const insertMany = this.db.transaction((items: typeof data) => {
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
    
    return insertMany(data);
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
  
  close(): void {
    this.checkpoint();
    this.db.close();
  }
}
