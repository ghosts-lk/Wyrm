/**
 * Wyrm File Sync - Watches and syncs .wyrm folder with database
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * 
 * - Watches for changes to markdown files
 * - Syncs changes to SQLite database
 * - Exports database state back to markdown
 */

import { watch, existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, basename, resolve, normalize, relative, sep } from 'path';
import { WyrmDB, Project, Session, Quest } from './database.js';

// ==================== PATH SECURITY ====================

/**
 * SECURITY: Validate path is within the base directory
 */
function validatePath(basePath: string, targetPath: string): string {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(basePath, targetPath));
  
  // Check if target is within base
  const rel = relative(normalizedBase, normalizedTarget);
  
  if (rel.startsWith('..') || rel.startsWith(sep)) {
    throw new Error('SECURITY: Path traversal detected');
  }
  
  if (!normalizedTarget.startsWith(normalizedBase)) {
    throw new Error('SECURITY: Path traversal detected');
  }
  
  return normalizedTarget;
}

/**
 * SECURITY: Validate project path is a real directory
 */
function validateProjectPath(projectPath: string): string {
  const normalizedPath = normalize(resolve(projectPath));
  
  if (!existsSync(normalizedPath)) {
    throw new Error(`Project path does not exist: ${projectPath}`);
  }
  
  if (!statSync(normalizedPath).isDirectory()) {
    throw new Error(`Project path is not a directory: ${projectPath}`);
  }
  
  return normalizedPath;
}

export class WyrmSync {
  private db: WyrmDB;
  private watchers: Map<string, ReturnType<typeof watch>> = new Map();
  
  constructor(db: WyrmDB) {
    this.db = db;
  }
  
  /**
   * Import markdown files from .wyrm folder into database
   */
  importFromFolder(projectPath: string): Project {
    // SECURITY: Validate project path
    const validatedPath = validateProjectPath(projectPath);
    const wyrmPath = validatePath(validatedPath, '.wyrm');
    
    if (!existsSync(wyrmPath)) {
      throw new Error(`No .wyrm folder found at ${validatedPath}`);
    }
    
    // Get or create project
    const projectName = basename(validatedPath);
    let project = this.db.getProject(validatedPath);
    
    if (!project) {
      project = this.db.registerProject(projectName, validatedPath);
    }
    
    // Import hoard.md - SECURITY: validatePath ensures no traversal
    const hoardPath = validatePath(wyrmPath, 'hoard.md');
    if (existsSync(hoardPath)) {
      const content = readFileSync(hoardPath, 'utf-8');
      this.parseHoard(project.id, content);
    }
    
    // Import chronicles.md
    const chroniclesPath = validatePath(wyrmPath, 'chronicles.md');
    if (existsSync(chroniclesPath)) {
      const content = readFileSync(chroniclesPath, 'utf-8');
      this.parseChronicles(project.id, content);
    }
    
    // Import quests.md
    const questsPath = validatePath(wyrmPath, 'quests.md');
    if (existsSync(questsPath)) {
      const content = readFileSync(questsPath, 'utf-8');
      this.parseQuests(project.id, content);
    }
    
    return project;
  }
  
  /**
   * Export database state to .wyrm folder
   */
  exportToFolder(projectPath: string): void {
    // SECURITY: Validate project path
    const validatedPath = validateProjectPath(projectPath);
    
    const project = this.db.getProject(validatedPath);
    if (!project) {
      throw new Error(`Project not found: ${validatedPath}`);
    }
    
    const wyrmPath = validatePath(validatedPath, '.wyrm');
    if (!existsSync(wyrmPath)) {
      mkdirSync(wyrmPath, { recursive: true });
    }
    
    // Export hoard.md - SECURITY: validatePath ensures no traversal
    const hoardContent = this.generateHoard(project);
    writeFileSync(validatePath(wyrmPath, 'hoard.md'), hoardContent);
    
    // Export chronicles.md
    const chroniclesContent = this.generateChronicles(project.id);
    writeFileSync(validatePath(wyrmPath, 'chronicles.md'), chroniclesContent);
    
    // Export quests.md
    const questsContent = this.generateQuests(project.id);
    writeFileSync(validatePath(wyrmPath, 'quests.md'), questsContent);
  }
  
  /**
   * Watch .wyrm folder for changes
   */
  watchFolder(projectPath: string): void {
    const wyrmPath = join(projectPath, '.wyrm');
    
    if (!existsSync(wyrmPath)) return;
    
    if (this.watchers.has(projectPath)) {
      this.watchers.get(projectPath)!.close();
    }
    
    const watcher = watch(wyrmPath, { recursive: true }, (eventType, filename) => {
      if (filename && filename.endsWith('.md')) {
        console.log(`[Wyrm] File changed: ${filename}`);
        this.importFromFolder(projectPath);
      }
    });
    
    this.watchers.set(projectPath, watcher);
  }
  
  stopWatching(projectPath: string): void {
    const watcher = this.watchers.get(projectPath);
    if (watcher) {
      watcher.close();
      this.watchers.delete(projectPath);
    }
  }
  
  // Parse hoard.md
  private parseHoard(projectId: number, content: string): void {
    const sections = this.splitSections(content);
    
    for (const [title, body] of Object.entries(sections)) {
      const key = title.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      this.db.setContext(projectId, key, body);
    }
  }
  
  // Parse chronicles.md
  private parseChronicles(projectId: number, content: string): void {
    const sessionRegex = /## Session:\s*(\d{4}-\d{2}-\d{2})([\s\S]*?)(?=## Session:|$)/g;
    let match;
    
    while ((match = sessionRegex.exec(content)) !== null) {
      const date = match[1];
      const body = match[2];
      
      // Check if session exists
      const existing = this.db.getTodaySession(projectId);
      if (existing && existing.date === date) {
        // Update existing
        this.db.updateSession(existing.id, this.parseSessionBody(body));
      } else {
        // Create new
        this.db.createSession(projectId, {
          date,
          ...this.parseSessionBody(body)
        });
      }
    }
  }
  
  private parseSessionBody(body: string): Partial<Session> {
    const result: Partial<Session> = {};
    
    const objectives = this.extractSection(body, 'Objectives', 'Mission');
    if (objectives) result.objectives = objectives;
    
    const completed = this.extractSection(body, 'Completed', 'Done', 'Quests Completed');
    if (completed) result.completed = completed;
    
    const issues = this.extractSection(body, 'Issues', 'Problems', 'Battles', 'Fixed');
    if (issues) result.issues = issues;
    
    const commits = this.extractSection(body, 'Commits');
    if (commits) result.commits = commits;
    
    const files = this.extractSection(body, 'Files', 'Changed');
    if (files) result.files_changed = files;
    
    const notes = this.extractSection(body, 'Notes', 'Wisdom');
    if (notes) result.notes = notes;
    
    return result;
  }
  
  // Parse quests.md
  private parseQuests(projectId: number, content: string): void {
    const lines = content.split('\n');
    let currentPriority: Quest['priority'] = 'medium';
    
    for (const line of lines) {
      // Check for priority headers
      if (line.match(/critical|urgent/i)) currentPriority = 'critical';
      else if (line.match(/high/i)) currentPriority = 'high';
      else if (line.match(/medium/i)) currentPriority = 'medium';
      else if (line.match(/low|future|backlog/i)) currentPriority = 'low';
      
      // Check for task items
      const taskMatch = line.match(/^[\s]*[-*]\s*\[([x\s])\]\s*\*?\*?(.+?)\*?\*?\s*$/i);
      if (taskMatch) {
        const isCompleted = taskMatch[1].toLowerCase() === 'x';
        const title = taskMatch[2].trim();
        
        // Add quest (avoid duplicates by title)
        const existing = this.db.getPendingQuests(projectId).find(q => q.title === title);
        if (!existing) {
          const quest = this.db.addQuest(projectId, title, '', currentPriority);
          if (isCompleted) {
            this.db.updateQuest(quest.id, 'completed');
          }
        }
      }
    }
  }
  
  // Generate hoard.md from database
  private generateHoard(project: Project): string {
    const context = this.db.getAllContext(project.id);
    const lines: string[] = [
      `# Wyrm Hoard // ${project.name}`,
      '',
      `> **Last Updated:** ${new Date().toISOString().split('T')[0]}`,
      `> **Project:** ${project.name}`,
      project.repo ? `> **Repo:** ${project.repo}` : '',
      '',
      '---',
      ''
    ];
    
    // Add all context sections
    for (const [key, value] of Object.entries(context)) {
      const title = key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      lines.push(`## ${title}`, '', value, '');
    }
    
    return lines.filter(l => l !== undefined).join('\n');
  }
  
  // Generate chronicles.md from database
  private generateChronicles(projectId: number): string {
    const sessions = this.db.getRecentSessions(projectId, 20);
    const lines: string[] = [
      '# Wyrm Chronicles',
      '',
      '> Session history',
      '',
      '---',
      ''
    ];
    
    for (const session of sessions) {
      lines.push(`## Session: ${session.date}`, '');
      
      if (session.objectives) {
        lines.push('### Objectives', session.objectives, '');
      }
      if (session.completed) {
        lines.push('### Completed', session.completed, '');
      }
      if (session.issues) {
        lines.push('### Issues Solved', session.issues, '');
      }
      if (session.commits) {
        lines.push('### Commits', session.commits, '');
      }
      if (session.files_changed) {
        lines.push('### Files Changed', session.files_changed, '');
      }
      if (session.notes) {
        lines.push('### Notes', session.notes, '');
      }
      
      lines.push('---', '');
    }
    
    return lines.join('\n');
  }
  
  // Generate quests.md from database
  private generateQuests(projectId: number): string {
    const pending = this.db.getPendingQuests(projectId);
    const completed = this.db.getRecentlyCompleted(projectId, 10);
    
    const lines: string[] = [
      '# Wyrm Quests',
      '',
      '> Task queue',
      '',
      '---',
      ''
    ];
    
    const byPriority = {
      critical: pending.filter(q => q.priority === 'critical'),
      high: pending.filter(q => q.priority === 'high'),
      medium: pending.filter(q => q.priority === 'medium'),
      low: pending.filter(q => q.priority === 'low')
    };
    
    if (byPriority.critical.length > 0) {
      lines.push('## Critical', '');
      for (const q of byPriority.critical) {
        lines.push(`- [ ] **${q.title}**${q.description ? ` - ${q.description}` : ''}`);
      }
      lines.push('');
    }
    
    if (byPriority.high.length > 0) {
      lines.push('## High Priority', '');
      for (const q of byPriority.high) {
        lines.push(`- [ ] **${q.title}**${q.description ? ` - ${q.description}` : ''}`);
      }
      lines.push('');
    }
    
    if (byPriority.medium.length > 0) {
      lines.push('## Medium Priority', '');
      for (const q of byPriority.medium) {
        lines.push(`- [ ] ${q.title}${q.description ? ` - ${q.description}` : ''}`);
      }
      lines.push('');
    }
    
    if (byPriority.low.length > 0) {
      lines.push('## Low Priority / Future', '');
      for (const q of byPriority.low) {
        lines.push(`- [ ] ${q.title}`);
      }
      lines.push('');
    }
    
    if (completed.length > 0) {
      lines.push('## Completed', '');
      for (const q of completed) {
        lines.push(`- [x] ${q.title} (${q.completed_at?.split('T')[0]})`);
      }
      lines.push('');
    }
    
    return lines.join('\n');
  }
  
  // Helpers
  private splitSections(content: string): Record<string, string> {
    const sections: Record<string, string> = {};
    const regex = /^##\s+(.+?)$/gm;
    let lastTitle = '';
    let lastIndex = 0;
    let match;
    
    while ((match = regex.exec(content)) !== null) {
      if (lastTitle) {
        sections[lastTitle] = content.slice(lastIndex, match.index).trim();
      }
      lastTitle = match[1];
      lastIndex = match.index + match[0].length;
    }
    
    if (lastTitle) {
      sections[lastTitle] = content.slice(lastIndex).trim();
    }
    
    return sections;
  }
  
  private extractSection(body: string, ...titles: string[]): string | undefined {
    for (const title of titles) {
      const regex = new RegExp(`###?\\s*${title}[^\\n]*\\n([\\s\\S]*?)(?=###|$)`, 'i');
      const match = body.match(regex);
      if (match) {
        return match[1].trim();
      }
    }
    return undefined;
  }
}
