/**
 * Wyrm Database - SQLite storage for infinite memory
 * 
 * Stores:
 * - Projects: Registered project metadata
 * - Sessions: Full session history with auto-summarization
 * - Context: Current project state (hoard)
 * - Quests: Task queue
 */

import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

export interface Project {
  id: number;
  name: string;
  path: string;
  repo?: string;
  stack?: string;
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
  is_archived: boolean;
}

export interface Quest {
  id: number;
  project_id: number;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in_progress' | 'completed' | 'abandoned';
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

export class WyrmDB {
  private db: Database.Database;
  
  constructor(dbPath?: string) {
    const wyrmnDir = join(homedir(), '.wyrm');
    if (!existsSync(wyrmnDir)) {
      mkdirSync(wyrmnDir, { recursive: true });
    }
    
    const path = dbPath || join(wyrmnDir, 'wyrm.db');
    this.db = new Database(path);
    this.init();
  }
  
  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        repo TEXT,
        stack TEXT,
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
        is_archived INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      
      CREATE TABLE IF NOT EXISTS quests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      
      CREATE TABLE IF NOT EXISTS context (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        key TEXT NOT NULL,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(project_id, key),
        FOREIGN KEY (project_id) REFERENCES projects(id)
      );
      
      CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_date ON sessions(date);
      CREATE INDEX IF NOT EXISTS idx_quests_project ON quests(project_id);
      CREATE INDEX IF NOT EXISTS idx_quests_status ON quests(status);
    `);
  }
  
  // Projects
  registerProject(name: string, path: string, repo?: string, stack?: string): Project {
    const stmt = this.db.prepare(`
      INSERT INTO projects (name, path, repo, stack)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(path) DO UPDATE SET
        name = excluded.name,
        repo = excluded.repo,
        stack = excluded.stack,
        updated_at = datetime('now')
      RETURNING *
    `);
    return stmt.get(name, path, repo, stack) as Project;
  }
  
  getProject(path: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(path) as Project | undefined;
  }
  
  getProjectById(id: number): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }
  
  // Sessions
  createSession(projectId: number, data: Partial<Session>): Session {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (project_id, date, objectives, completed, issues, commits, files_changed, notes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
      data.notes || ''
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
  
  // Quests
  addQuest(projectId: number, title: string, description?: string, priority: Quest['priority'] = 'medium'): Quest {
    return this.db.prepare(`
      INSERT INTO quests (project_id, title, description, priority)
      VALUES (?, ?, ?, ?)
      RETURNING *
    `).get(projectId, title, description || '', priority) as Quest;
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
  
  getRecentlyCompleted(projectId: number, limit = 5): Quest[] {
    return this.db.prepare(`
      SELECT * FROM quests 
      WHERE project_id = ? AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(projectId, limit) as Quest[];
  }
  
  // Context
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
  
  // Stats
  getStats(): { projects: number; sessions: number; quests: number } {
    const projects = this.db.prepare('SELECT COUNT(*) as count FROM projects').get() as { count: number };
    const sessions = this.db.prepare('SELECT COUNT(*) as count FROM sessions').get() as { count: number };
    const quests = this.db.prepare('SELECT COUNT(*) as count FROM quests').get() as { count: number };
    
    return {
      projects: projects.count,
      sessions: sessions.count,
      quests: quests.count
    };
  }
  
  close() {
    this.db.close();
  }
}
