/**
 * Wyrm VS Code Extension
 * 
 * Features:
 * - Auto-detect .wyrm folder on workspace open
 * - Inject context into Copilot/AI prompts
 * - Auto-save session on workspace close
 * - Sidebar with context, quests, sessions views
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { WyrmDB } from './database';
import { WyrmSync } from './sync';
import { QuestsProvider, SessionsProvider, ContextProvider } from './views';

let db: WyrmDB;
let sync: WyrmSync;
let currentSession: { projectId: number; sessionId: number } | null = null;
let sessionStartTime: Date | null = null;

export function activate(context: vscode.ExtensionContext) {
  console.log('Wyrm activated');
  
  // Initialize database
  const dbPath = path.join(context.globalStorageUri.fsPath, 'wyrm.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  db = new WyrmDB(dbPath);
  sync = new WyrmSync(db);
  
  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('wyrm.init', initWyrm),
    vscode.commands.registerCommand('wyrm.showContext', showContext),
    vscode.commands.registerCommand('wyrm.startSession', startSession),
    vscode.commands.registerCommand('wyrm.saveSession', saveSession),
    vscode.commands.registerCommand('wyrm.addQuest', addQuest),
    vscode.commands.registerCommand('wyrm.completeQuest', completeQuest),
    vscode.commands.registerCommand('wyrm.sync', syncWyrm),
  );
  
  // Register tree views
  const questsProvider = new QuestsProvider(db);
  const sessionsProvider = new SessionsProvider(db);
  const contextProvider = new ContextProvider(db);
  
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('wyrm.quests', questsProvider),
    vscode.window.registerTreeDataProvider('wyrm.sessions', sessionsProvider),
    vscode.window.registerTreeDataProvider('wyrm.context', contextProvider),
  );
  
  // Auto-load on workspace open
  if (vscode.workspace.workspaceFolders) {
    for (const folder of vscode.workspace.workspaceFolders) {
      const wyrmPath = path.join(folder.uri.fsPath, '.wyrm');
      if (fs.existsSync(wyrmPath)) {
        autoLoadProject(folder.uri.fsPath);
        break;
      }
    }
  }
  
  // Auto-save on workspace close
  context.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders(() => {
      if (currentSession) {
        autoSaveSession();
      }
    })
  );
  
  // Watch for .wyrm file changes
  const watcher = vscode.workspace.createFileSystemWatcher('**/.wyrm/*.md');
  watcher.onDidChange(uri => {
    const projectPath = path.dirname(path.dirname(uri.fsPath));
    try {
      sync.importFromFolder(projectPath);
      questsProvider.refresh();
      sessionsProvider.refresh();
      contextProvider.refresh();
    } catch {
      // Ignore errors
    }
  });
  context.subscriptions.push(watcher);
  
  // Status bar
  const statusBar = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBar.text = '$(flame) Wyrm';
  statusBar.tooltip = 'Click to show Wyrm context';
  statusBar.command = 'wyrm.showContext';
  statusBar.show();
  context.subscriptions.push(statusBar);
  
  // Provide context to Copilot (if possible)
  registerCopilotIntegration(context);
}

async function autoLoadProject(projectPath: string) {
  try {
    const project = sync.importFromFolder(projectPath);
    
    // Start session automatically
    let session = db.getTodaySession(project.id);
    if (!session) {
      session = db.createSession(project.id, {
        objectives: 'Auto-started session'
      });
    }
    
    currentSession = { projectId: project.id, sessionId: session.id };
    sessionStartTime = new Date();
    
    vscode.window.showInformationMessage(`Wyrm: Loaded ${project.name}`);
  } catch (e) {
    console.error('Wyrm auto-load failed:', e);
  }
}

async function autoSaveSession() {
  if (!currentSession) return;
  
  const project = db.getProjectById(currentSession.projectId);
  if (!project) return;
  
  // Get git changes
  const gitChanges = await getGitChanges(project.path);
  
  // Update session
  db.updateSession(currentSession.sessionId, {
    commits: gitChanges.commits,
    files_changed: gitChanges.files,
  });
  
  // Export to .wyrm folder
  try {
    sync.exportToFolder(project.path);
  } catch {
    // Ignore if no .wyrm folder
  }
}

async function initWyrm() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) {
    vscode.window.showErrorMessage('No workspace folder open');
    return;
  }
  
  const projectPath = workspaceFolder.uri.fsPath;
  const wyrmPath = path.join(projectPath, '.wyrm');
  
  // Create .wyrm folder
  if (!fs.existsSync(wyrmPath)) {
    fs.mkdirSync(wyrmPath, { recursive: true });
    
    // Create default files
    const projectName = path.basename(projectPath);
    
    fs.writeFileSync(path.join(wyrmPath, 'hoard.md'), `# Wyrm Hoard // ${projectName}

> **Last Updated:** ${new Date().toISOString().split('T')[0]}
> **Project:** ${projectName}

## Project Overview

**Name:** ${projectName}
**Type:** 
**Stack:** 

## Current Status

### Completed
- [ ] 

### In Progress
- [ ] 

## Architecture

### Key Files
| File | Purpose |
|------|---------|

## Notes

`);
    
    fs.writeFileSync(path.join(wyrmPath, 'chronicles.md'), `# Wyrm Chronicles // ${projectName}

> Session history

---

`);
    
    fs.writeFileSync(path.join(wyrmPath, 'quests.md'), `# Wyrm Quests // ${projectName}

> Task queue

---

## High Priority

- [ ] 

## Medium Priority

- [ ] 

## Completed

`);
    
    fs.writeFileSync(path.join(wyrmPath, 'protocol.md'), `# Wyrm Protocol // ${projectName}

> AI guidelines

## Session Start
Read .wyrm/ folder first.

## Session End
1. Update chronicles.md with what was done
2. Update quests.md with completed/new tasks
3. Commit and push
`);
  }
  
  // Load into database
  const project = sync.importFromFolder(projectPath);
  
  vscode.window.showInformationMessage(`Wyrm initialized for ${project.name}`);
}

async function showContext() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  
  const project = db.getProject(workspaceFolder.uri.fsPath);
  if (!project) {
    vscode.window.showWarningMessage('No Wyrm project found. Run "Wyrm: Initialize Memory" first.');
    return;
  }
  
  const context = db.getAllContext(project.id);
  const sessions = db.getRecentSessions(project.id, 3);
  const quests = db.getPendingQuests(project.id);
  
  // Create markdown content
  const content = `# ${project.name} Context

## Architecture
${context['architecture'] || context['key_files'] || 'No architecture info'}

## Recent Sessions
${sessions.map(s => `- ${s.date}: ${s.completed?.split('\n')[0] || 'No info'}`).join('\n')}

## Pending Quests (${quests.length})
${quests.slice(0, 5).map(q => `- [${q.priority}] ${q.title}`).join('\n')}
`;
  
  const doc = await vscode.workspace.openTextDocument({
    content,
    language: 'markdown'
  });
  await vscode.window.showTextDocument(doc);
}

async function startSession() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  
  const projectPath = workspaceFolder.uri.fsPath;
  
  // Get objectives
  const objectives = await vscode.window.showInputBox({
    prompt: 'What are the objectives for this session?',
    placeHolder: 'e.g., Fix login bug, add new feature...'
  });
  
  // Register project
  const projectName = path.basename(projectPath);
  const project = db.registerProject(projectName, projectPath);
  
  // Create session
  let session = db.getTodaySession(project.id);
  if (!session) {
    session = db.createSession(project.id, { objectives });
  } else if (objectives) {
    session = db.updateSession(session.id, { objectives });
  }
  
  currentSession = { projectId: project.id, sessionId: session.id };
  sessionStartTime = new Date();
  
  vscode.window.showInformationMessage(`Session started: ${objectives || 'No objectives set'}`);
}

async function saveSession() {
  if (!currentSession) {
    vscode.window.showWarningMessage('No active session. Run "Wyrm: Start Session" first.');
    return;
  }
  
  const project = db.getProjectById(currentSession.projectId);
  if (!project) return;
  
  // Get completed work
  const completed = await vscode.window.showInputBox({
    prompt: 'What was completed this session?',
    placeHolder: 'e.g., Fixed login bug, added rate limiting...'
  });
  
  // Get git info
  const gitChanges = await getGitChanges(project.path);
  
  // Update session
  const session = db.updateSession(currentSession.sessionId, {
    completed,
    commits: gitChanges.commits,
    files_changed: gitChanges.files,
  });
  
  // Export to .wyrm folder
  try {
    sync.exportToFolder(project.path);
    vscode.window.showInformationMessage('Session saved and exported to .wyrm folder');
  } catch (e) {
    vscode.window.showInformationMessage('Session saved to database');
  }
}

async function addQuest() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  
  const project = db.getProject(workspaceFolder.uri.fsPath);
  if (!project) {
    vscode.window.showWarningMessage('No Wyrm project found.');
    return;
  }
  
  const title = await vscode.window.showInputBox({
    prompt: 'Quest title',
    placeHolder: 'e.g., Implement payment gateway'
  });
  if (!title) return;
  
  const priority = await vscode.window.showQuickPick(
    ['critical', 'high', 'medium', 'low'],
    { placeHolder: 'Priority' }
  ) as 'critical' | 'high' | 'medium' | 'low' | undefined;
  
  const quest = db.addQuest(project.id, title, '', priority || 'medium');
  
  try {
    sync.exportToFolder(workspaceFolder.uri.fsPath);
  } catch {
    // Ignore
  }
  
  vscode.window.showInformationMessage(`Quest added: ${quest.title}`);
}

async function completeQuest() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  
  const project = db.getProject(workspaceFolder.uri.fsPath);
  if (!project) return;
  
  const quests = db.getPendingQuests(project.id);
  if (quests.length === 0) {
    vscode.window.showInformationMessage('No pending quests');
    return;
  }
  
  const selected = await vscode.window.showQuickPick(
    quests.map(q => ({ label: q.title, description: q.priority, id: q.id })),
    { placeHolder: 'Select quest to complete' }
  );
  
  if (selected) {
    db.updateQuest(selected.id, 'completed');
    
    try {
      sync.exportToFolder(workspaceFolder.uri.fsPath);
    } catch {
      // Ignore
    }
    
    vscode.window.showInformationMessage(`Quest completed: ${selected.label}`);
  }
}

async function syncWyrm() {
  const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
  if (!workspaceFolder) return;
  
  try {
    sync.importFromFolder(workspaceFolder.uri.fsPath);
    sync.exportToFolder(workspaceFolder.uri.fsPath);
    vscode.window.showInformationMessage('Wyrm synced successfully');
  } catch (e) {
    vscode.window.showErrorMessage(`Sync failed: ${e}`);
  }
}

async function getGitChanges(projectPath: string): Promise<{ commits: string; files: string }> {
  try {
    const { execSync } = require('child_process');
    
    const commits = execSync('git log --oneline -5', { cwd: projectPath, encoding: 'utf-8' }).trim();
    const files = execSync('git diff --name-only HEAD~5 HEAD 2>/dev/null || git diff --name-only', { 
      cwd: projectPath, 
      encoding: 'utf-8' 
    }).trim();
    
    return { commits, files };
  } catch {
    return { commits: '', files: '' };
  }
}

function registerCopilotIntegration(context: vscode.ExtensionContext) {
  // Register a participant that Copilot can use
  try {
    // This is for future Copilot extensibility API
    // Currently, we inject context via .github/copilot-instructions.md
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) return;
    
    const instructionsPath = path.join(workspaceFolder.uri.fsPath, '.github', 'copilot-instructions.md');
    const wyrmPath = path.join(workspaceFolder.uri.fsPath, '.wyrm');
    
    if (fs.existsSync(wyrmPath)) {
      // Create .github folder if needed
      const githubPath = path.join(workspaceFolder.uri.fsPath, '.github');
      if (!fs.existsSync(githubPath)) {
        fs.mkdirSync(githubPath, { recursive: true });
      }
      
      // Create/update copilot-instructions.md
      const instruction = `# Copilot Instructions

At the start of any conversation, read the .wyrm/ folder for project context:
- .wyrm/hoard.md - Project state and architecture
- .wyrm/chronicles.md - Recent session history
- .wyrm/quests.md - Pending tasks
- .wyrm/protocol.md - Project-specific guidelines

This project uses Wyrm for persistent AI memory.
`;
      
      if (!fs.existsSync(instructionsPath)) {
        fs.writeFileSync(instructionsPath, instruction);
      }
    }
  } catch {
    // Ignore errors in Copilot integration
  }
}

export function deactivate() {
  // Auto-save on deactivation
  if (currentSession) {
    autoSaveSession();
  }
  
  if (db) {
    db.close();
  }
}
