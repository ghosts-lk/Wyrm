/**
 * Wyrm Tree View Providers
 * 
 * Provides sidebar views for Quests, Sessions, and Context
 */

import * as vscode from 'vscode';
import { WyrmDB, Quest, Session } from './database';

// === QUESTS PROVIDER ===

export class QuestsProvider implements vscode.TreeDataProvider<QuestItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<QuestItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private db: WyrmDB) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: QuestItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: QuestItem): Thenable<QuestItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    // Get current project
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return Promise.resolve([]);
    }

    const project = this.db.getProject(workspaceFolder.uri.fsPath);
    if (!project) {
      return Promise.resolve([
        new QuestItem('No Wyrm project', '', 'medium', 'pending', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    const quests = this.db.getPendingQuests(project.id);
    
    if (quests.length === 0) {
      return Promise.resolve([
        new QuestItem('No pending quests', '', 'medium', 'pending', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    return Promise.resolve(
      quests.map(q => new QuestItem(
        q.title, 
        q.description, 
        q.priority, 
        q.status,
        vscode.TreeItemCollapsibleState.None
      ))
    );
  }
}

class QuestItem extends vscode.TreeItem {
  constructor(
    public readonly title: string,
    public readonly description: string,
    public readonly priority: string,
    public readonly status: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(title, collapsibleState);
    
    // Set icon based on priority
    const iconMap: Record<string, string> = {
      'critical': '🔴',
      'high': '🟠',
      'medium': '🟡',
      'low': '🟢'
    };
    
    this.label = `${iconMap[priority] || '⚪'} ${title}`;
    this.tooltip = `${priority.toUpperCase()}: ${title}\n${description}`;
    
    if (status === 'in-progress') {
      this.label = `🔄 ${title}`;
    }
  }
}

// === SESSIONS PROVIDER ===

export class SessionsProvider implements vscode.TreeDataProvider<SessionItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private db: WyrmDB) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: SessionItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: SessionItem): Thenable<SessionItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return Promise.resolve([]);
    }

    const project = this.db.getProject(workspaceFolder.uri.fsPath);
    if (!project) {
      return Promise.resolve([]);
    }

    const sessions = this.db.getRecentSessions(project.id, 10);
    
    if (sessions.length === 0) {
      return Promise.resolve([
        new SessionItem('No sessions recorded', '', '', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    return Promise.resolve(
      sessions.map(s => new SessionItem(
        s.date,
        s.objectives || '',
        s.completed || '',
        vscode.TreeItemCollapsibleState.None
      ))
    );
  }
}

class SessionItem extends vscode.TreeItem {
  constructor(
    public readonly date: string,
    public readonly objectives: string,
    public readonly completed: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(date, collapsibleState);
    
    const today = new Date().toISOString().split('T')[0];
    const icon = date === today ? '📍' : '📅';
    
    this.label = `${icon} ${date}`;
    this.tooltip = `Objectives: ${objectives}\nCompleted: ${completed}`;
    this.description = objectives.slice(0, 40) + (objectives.length > 40 ? '...' : '');
  }
}

// === CONTEXT PROVIDER ===

export class ContextProvider implements vscode.TreeDataProvider<ContextItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<ContextItem | undefined | null | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  constructor(private db: WyrmDB) {}

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: ContextItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: ContextItem): Thenable<ContextItem[]> {
    if (element) {
      return Promise.resolve([]);
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
      return Promise.resolve([]);
    }

    const project = this.db.getProject(workspaceFolder.uri.fsPath);
    if (!project) {
      return Promise.resolve([
        new ContextItem('No project', 'Run Wyrm: Initialize', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    const context = this.db.getAllContext(project.id);
    const keys = Object.keys(context).filter(k => !k.endsWith('_full'));
    
    if (keys.length === 0) {
      return Promise.resolve([
        new ContextItem('No context stored', 'Edit .wyrm/hoard.md', vscode.TreeItemCollapsibleState.None)
      ]);
    }

    return Promise.resolve(
      keys.map(k => new ContextItem(
        k.replace(/_/g, ' '),
        context[k].slice(0, 50) + '...',
        vscode.TreeItemCollapsibleState.None
      ))
    );
  }
}

class ContextItem extends vscode.TreeItem {
  constructor(
    public readonly key: string,
    public readonly value: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState
  ) {
    super(key, collapsibleState);
    
    this.label = `📋 ${key.charAt(0).toUpperCase() + key.slice(1)}`;
    this.tooltip = value;
    this.description = value.slice(0, 30);
  }
}
