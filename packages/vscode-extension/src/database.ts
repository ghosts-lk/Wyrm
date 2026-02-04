/**
 * Wyrm Database Layer for VS Code Extension
 * 
 * Uses SQLite for persistent storage
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

export interface Project {
  id: number;
  name: string;
  path: string;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  project_id: number;
  date: string;
  objectives: string | null;
  completed: string | null;
  issues: string | null;
  commits: string | null;
  files_changed: string | null;
  summary: string | null;
  archived: number;
}

export interface Quest {
  id: number;
  project_id: number;
  title: string;
  description: string;
  priority: 'critical' | 'high' | 'medium' | 'low';
  status: 'pending' | 'in-progress' | 'completed';
  created_at: string;
  completed_at: string | null;
}

export interface ContextEntry {
  id: number;
  project_id: number;
  key: string;
  value: string;
  updated_at: string;
}

export class WyrmDB {
  private db: Database.Database;

  constructor(dbPath: string) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.init();
  }

  private init() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        path TEXT UNIQUE NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        project_id INTEGER NOT NULL,
        date TEXT DEFAULT (date('now')),
        objectives TEXT,
        completed TEXT,
        issues TEXT,
        commits TEXT,
        files_changed TEXT,
        summary TEXT,
        archived INTEGER DEFAULT 0,
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

  // Project methods
  registerProject(name: string, projectPath: string): Project {
    const existing = this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath) as Project | undefined;
    
    if (existing) {
      this.db.prepare('UPDATE projects SET updated_at = datetime("now") WHERE id = ?').run(existing.id);
      return existing;
    }

    const result = this.db.prepare('INSERT INTO projects (name, path) VALUES (?, ?)').run(name, projectPath);
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(result.lastInsertRowid) as Project;
  }

  getProject(projectPath: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE path = ?').get(projectPath) as Project | undefined;
  }

  getProjectById(id: number): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }

  // Session methods
  createSession(projectId: number, data: Partial<Session>): Session {
    const result = this.db.prepare(`
      INSERT INTO sessions (project_id, objectives)
      VALUES (?, ?)
    `).run(projectId, data.objectives || null);

    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(result.lastInsertRowid) as Session;
  }

  getTodaySession(projectId: number): Session | undefined {
    return this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ? AND date = date('now') AND archived = 0
      ORDER BY id DESC LIMIT 1
    `).get(projectId) as Session | undefined;
  }

  updateSession(sessionId: number, data: Partial<Session>): Session {
    const updates: string[] = [];
    const values: any[] = [];

    if (data.objectives !== undefined) {
      updates.push('objectives = ?');
      values.push(data.objectives);
    }
    if (data.completed !== undefined) {
      updates.push('completed = ?');
      values.push(data.completed);
    }
    if (data.issues !== undefined) {
      updates.push('issues = ?');
      values.push(data.issues);
    }
    if (data.commits !== undefined) {
      updates.push('commits = ?');
      values.push(data.commits);
    }
    if (data.files_changed !== undefined) {
      updates.push('files_changed = ?');
      values.push(data.files_changed);
    }
    if (data.summary !== undefined) {
      updates.push('summary = ?');
      values.push(data.summary);
    }

    if (updates.length > 0) {
      values.push(sessionId);
      this.db.prepare(`UPDATE sessions SET ${updates.join(', ')} WHERE id = ?`).run(...values);
    }

    return this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as Session;
  }

  getRecentSessions(projectId: number, limit: number = 5): Session[] {
    return this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ? AND archived = 0
      ORDER BY date DESC, id DESC
      LIMIT ?
    `).all(projectId, limit) as Session[];
  }

  getAllSessions(projectId: number): Session[] {
    return this.db.prepare(`
      SELECT * FROM sessions 
      WHERE project_id = ?
      ORDER BY date DESC, id DESC
    `).all(projectId) as Session[];
  }

  archiveOldSessions(projectId: number, keepDays: number = 7): number {
    const result = this.db.prepare(`
      UPDATE sessions 
      SET archived = 1
      WHERE project_id = ? 
        AND date < date('now', '-' || ? || ' days')
        AND archived = 0
    `).run(projectId, keepDays);
    
    return result.changes;
  }

  // Quest methods
  addQuest(projectId: number, title: string, description: string = '', priority: 'critical' | 'high' | 'medium' | 'low' = 'medium'): Quest {
    const result = this.db.prepare(`
      INSERT INTO quests (project_id, title, description, priority)
      VALUES (?, ?, ?, ?)
    `).run(projectId, title, description, priority);

    return this.db.prepare('SELECT * FROM quests WHERE id = ?').get(result.lastInsertRowid) as Quest;
  }

  getPendingQuests(projectId: number): Quest[] {
    return this.db.prepare(`
      SELECT * FROM quests 
      WHERE project_id = ? AND status != 'completed'
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

  updateQuest(questId: number, status: 'pending' | 'in-progress' | 'completed'): Quest {
    const completedAt = status === 'completed' ? `datetime('now')` : 'NULL';
    
    this.db.prepare(`
      UPDATE quests 
      SET status = ?, completed_at = ${status === 'completed' ? "datetime('now')" : 'NULL'}
      WHERE id = ?
    `).run(status, questId);

    return this.db.prepare('SELECT * FROM quests WHERE id = ?').get(questId) as Quest;
  }

  getCompletedQuests(projectId: number, limit: number = 10): Quest[] {
    return this.db.prepare(`
      SELECT * FROM quests 
      WHERE project_id = ? AND status = 'completed'
      ORDER BY completed_at DESC
      LIMIT ?
    `).all(projectId, limit) as Quest[];
  }

  // Context methods
  setContext(projectId: number, key: string, value: string): ContextEntry {
    this.db.prepare(`
      INSERT INTO context (project_id, key, value)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id, key) DO UPDATE SET value = ?, updated_at = datetime('now')
    `).run(projectId, key, value, value);

    return this.db.prepare('SELECT * FROM context WHERE project_id = ? AND key = ?').get(projectId, key) as ContextEntry;
  }

  getContext(projectId: number, key: string): string | undefined {
    const entry = this.db.prepare('SELECT value FROM context WHERE project_id = ? AND key = ?').get(projectId, key) as { value: string } | undefined;
    return entry?.value;
  }

  getAllContext(projectId: number): Record<string, string> {
    const entries = this.db.prepare('SELECT key, value FROM context WHERE project_id = ?').all(projectId) as { key: string; value: string }[];
    return Object.fromEntries(entries.map(e => [e.key, e.value]));
  }

  close() {
    this.db.close();
  }
}
