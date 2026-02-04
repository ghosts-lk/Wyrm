/**
 * Wyrm Sync - Bidirectional sync between .wyrm folder and database
 */

import * as fs from 'fs';
import * as path from 'path';
import { WyrmDB, Project, Session, Quest } from './database';

export class WyrmSync {
  private db: WyrmDB;

  constructor(db: WyrmDB) {
    this.db = db;
  }

  /**
   * Import .wyrm folder contents into database
   */
  importFromFolder(projectPath: string): Project {
    const wyrmPath = path.join(projectPath, '.wyrm');
    const projectName = path.basename(projectPath);

    if (!fs.existsSync(wyrmPath)) {
      throw new Error(`No .wyrm folder found in ${projectPath}`);
    }

    // Register/update project
    const project = this.db.registerProject(projectName, projectPath);

    // Parse hoard.md for context
    const hoardPath = path.join(wyrmPath, 'hoard.md');
    if (fs.existsSync(hoardPath)) {
      const content = fs.readFileSync(hoardPath, 'utf-8');
      this.parseHoard(project.id, content);
    }

    // Parse chronicles.md for sessions
    const chroniclesPath = path.join(wyrmPath, 'chronicles.md');
    if (fs.existsSync(chroniclesPath)) {
      const content = fs.readFileSync(chroniclesPath, 'utf-8');
      this.parseChronicles(project.id, content);
    }

    // Parse quests.md for tasks
    const questsPath = path.join(wyrmPath, 'quests.md');
    if (fs.existsSync(questsPath)) {
      const content = fs.readFileSync(questsPath, 'utf-8');
      this.parseQuests(project.id, content);
    }

    return project;
  }

  /**
   * Export database contents to .wyrm folder
   */
  exportToFolder(projectPath: string): void {
    const wyrmPath = path.join(projectPath, '.wyrm');
    
    if (!fs.existsSync(wyrmPath)) {
      fs.mkdirSync(wyrmPath, { recursive: true });
    }

    const project = this.db.getProject(projectPath);
    if (!project) {
      throw new Error(`Project not found for ${projectPath}`);
    }

    // Export hoard.md
    const hoardContent = this.generateHoard(project);
    fs.writeFileSync(path.join(wyrmPath, 'hoard.md'), hoardContent);

    // Export chronicles.md
    const chroniclesContent = this.generateChronicles(project);
    fs.writeFileSync(path.join(wyrmPath, 'chronicles.md'), chroniclesContent);

    // Export quests.md
    const questsContent = this.generateQuests(project);
    fs.writeFileSync(path.join(wyrmPath, 'quests.md'), questsContent);
  }

  // === PARSING METHODS ===

  private parseHoard(projectId: number, content: string): void {
    // Extract sections from hoard.md
    const sections: Record<string, string> = {};
    
    const sectionRegex = /^##\s+(.+)$/gm;
    let match;
    let lastSection = '';
    let lastIndex = 0;

    while ((match = sectionRegex.exec(content)) !== null) {
      if (lastSection) {
        sections[lastSection.toLowerCase().replace(/\s+/g, '_')] = content.slice(lastIndex, match.index).trim();
      }
      lastSection = match[1];
      lastIndex = match.index + match[0].length;
    }

    if (lastSection) {
      sections[lastSection.toLowerCase().replace(/\s+/g, '_')] = content.slice(lastIndex).trim();
    }

    // Store each section as context
    for (const [key, value] of Object.entries(sections)) {
      if (value.trim()) {
        this.db.setContext(projectId, key, value);
      }
    }

    // Store full hoard as well
    this.db.setContext(projectId, 'hoard_full', content);
  }

  private parseChronicles(projectId: number, content: string): void {
    // Parse sessions from chronicles.md
    // Format: ## YYYY-MM-DD
    const sessionRegex = /^##\s+(\d{4}-\d{2}-\d{2})/gm;
    let match;
    const sessionDates: string[] = [];

    while ((match = sessionRegex.exec(content)) !== null) {
      sessionDates.push(match[1]);
    }

    // Store as context for now (full parsing would be more complex)
    this.db.setContext(projectId, 'chronicles_full', content);
  }

  private parseQuests(projectId: number, content: string): void {
    // Parse tasks from quests.md
    // Format: - [ ] Task (pending) or - [x] Task (completed)
    
    const taskRegex = /^-\s+\[([ xX])\]\s+(.+)$/gm;
    let match;
    
    // Get existing quests to avoid duplicates
    const existingQuests = this.db.getPendingQuests(projectId);
    const existingTitles = new Set(existingQuests.map(q => q.title.toLowerCase()));

    // Determine current section for priority
    let currentPriority: 'critical' | 'high' | 'medium' | 'low' = 'medium';
    const lines = content.split('\n');
    
    for (const line of lines) {
      // Check for priority headers
      const lowerLine = line.toLowerCase();
      if (lowerLine.includes('critical')) currentPriority = 'critical';
      else if (lowerLine.includes('high')) currentPriority = 'high';
      else if (lowerLine.includes('medium')) currentPriority = 'medium';
      else if (lowerLine.includes('low')) currentPriority = 'low';
      else if (lowerLine.includes('completed')) currentPriority = 'low'; // Completed section
      
      // Parse task
      const taskMatch = line.match(/^-\s+\[([ xX])\]\s+(.+)$/);
      if (taskMatch) {
        const isCompleted = taskMatch[1].toLowerCase() === 'x';
        const title = taskMatch[2].trim();
        
        // Don't import if already exists
        if (!existingTitles.has(title.toLowerCase())) {
          const quest = this.db.addQuest(projectId, title, '', currentPriority);
          if (isCompleted) {
            this.db.updateQuest(quest.id, 'completed');
          }
          existingTitles.add(title.toLowerCase());
        }
      }
    }

    // Store full quests as context
    this.db.setContext(projectId, 'quests_full', content);
  }

  // === GENERATION METHODS ===

  private generateHoard(project: Project): string {
    const context = this.db.getAllContext(project.id);
    const today = new Date().toISOString().split('T')[0];

    // Try to preserve existing structure if we have it
    if (context['hoard_full']) {
      // Update the last updated date
      return context['hoard_full'].replace(
        /\*\*Last Updated:\*\*\s+\d{4}-\d{2}-\d{2}/,
        `**Last Updated:** ${today}`
      );
    }

    // Generate new hoard
    return `# Wyrm Hoard // ${project.name}

> **Last Updated:** ${today}
> **Project:** ${project.name}

## Project Overview

**Name:** ${project.name}
**Path:** ${project.path}

## Current Status

${context['current_status'] || 'No status recorded yet.'}

## Architecture

${context['architecture'] || 'No architecture info yet.'}

## Notes

${context['notes'] || ''}
`;
  }

  private generateChronicles(project: Project): string {
    const sessions = this.db.getAllSessions(project.id);
    const today = new Date().toISOString().split('T')[0];

    let content = `# Wyrm Chronicles // ${project.name}

> Session history - Auto-generated ${today}

---

`;

    // Group sessions by date
    const byDate = new Map<string, Session[]>();
    for (const session of sessions) {
      const existing = byDate.get(session.date) || [];
      existing.push(session);
      byDate.set(session.date, existing);
    }

    // Generate entries (most recent first)
    const sortedDates = Array.from(byDate.keys()).sort().reverse();
    
    for (const date of sortedDates.slice(0, 20)) { // Keep last 20 days
      const daySessions = byDate.get(date)!;
      
      content += `## ${date}\n\n`;
      
      for (const session of daySessions) {
        if (session.objectives) {
          content += `**Objectives:** ${session.objectives}\n`;
        }
        if (session.completed) {
          content += `**Completed:**\n${session.completed}\n`;
        }
        if (session.commits) {
          content += `**Commits:**\n\`\`\`\n${session.commits}\n\`\`\`\n`;
        }
        if (session.issues) {
          content += `**Issues:** ${session.issues}\n`;
        }
        content += '\n';
      }
      
      content += '---\n\n';
    }

    return content;
  }

  private generateQuests(project: Project): string {
    const pending = this.db.getPendingQuests(project.id);
    const completed = this.db.getCompletedQuests(project.id, 20);
    const today = new Date().toISOString().split('T')[0];

    let content = `# Wyrm Quests // ${project.name}

> Task queue - Auto-generated ${today}

---

`;

    // Group pending by priority
    const byPriority: Record<string, Quest[]> = {
      critical: [],
      high: [],
      medium: [],
      low: []
    };

    for (const quest of pending) {
      byPriority[quest.priority].push(quest);
    }

    for (const priority of ['critical', 'high', 'medium', 'low']) {
      const quests = byPriority[priority];
      if (quests.length > 0) {
        content += `## ${priority.charAt(0).toUpperCase() + priority.slice(1)} Priority\n\n`;
        for (const quest of quests) {
          const status = quest.status === 'in-progress' ? '🔄 ' : '';
          content += `- [ ] ${status}${quest.title}\n`;
        }
        content += '\n';
      }
    }

    // Completed section
    if (completed.length > 0) {
      content += `## Completed\n\n`;
      for (const quest of completed) {
        content += `- [x] ${quest.title}${quest.completed_at ? ` (${quest.completed_at.split('T')[0]})` : ''}\n`;
      }
      content += '\n';
    }

    return content;
  }
}
