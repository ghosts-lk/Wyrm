#!/usr/bin/env node

/**
 * Wyrm MCP Server
 * 
 * Model Context Protocol server that provides:
 * - Automatic project context injection
 * - Session tracking and persistence
 * - Quest/TODO management
 * - Infinite memory through summarization
 * 
 * Tools:
 * - wyrm_context: Get full project context
 * - wyrm_session_start: Start/continue today's session
 * - wyrm_session_update: Update current session
 * - wyrm_quest_add: Add a new task
 * - wyrm_quest_complete: Mark task done
 * - wyrm_search: Search memory
 * 
 * Resources:
 * - wyrm://project/{path}: Project context
 * - wyrm://sessions/{path}: Recent sessions
 * - wyrm://quests/{path}: Pending tasks
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { WyrmDB } from './database.js';
import { WyrmSync } from './sync.js';
import { createContextBundle, summarizeSession } from './summarizer.js';

// Initialize database
const db = new WyrmDB();
const sync = new WyrmSync(db);

// Create server
const server = new Server(
  {
    name: 'wyrm',
    version: '1.0.0',
  },
  {
    capabilities: {
      tools: {},
      resources: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'wyrm_context',
        description: 'Get full project context including state, recent sessions, and pending tasks. Call this at the start of every session.',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            maxTokens: {
              type: 'number',
              description: 'Maximum tokens for context (default: 4000)',
            },
          },
          required: ['projectPath'],
        },
      },
      {
        name: 'wyrm_session_start',
        description: 'Start or continue today\'s session. Records objectives.',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            objectives: {
              type: 'string',
              description: 'What are the goals for this session?',
            },
          },
          required: ['projectPath'],
        },
      },
      {
        name: 'wyrm_session_update',
        description: 'Update the current session with completed work, issues solved, commits, etc.',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            completed: {
              type: 'string',
              description: 'What was completed this session?',
            },
            issues: {
              type: 'string',
              description: 'What issues were solved?',
            },
            commits: {
              type: 'string',
              description: 'Commit hashes and messages',
            },
            filesChanged: {
              type: 'string',
              description: 'List of files modified',
            },
            notes: {
              type: 'string',
              description: 'Any important notes or gotchas',
            },
          },
          required: ['projectPath'],
        },
      },
      {
        name: 'wyrm_quest_add',
        description: 'Add a new task/quest to the queue',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            title: {
              type: 'string',
              description: 'Task title',
            },
            description: {
              type: 'string',
              description: 'Task description',
            },
            priority: {
              type: 'string',
              enum: ['critical', 'high', 'medium', 'low'],
              description: 'Task priority',
            },
          },
          required: ['projectPath', 'title'],
        },
      },
      {
        name: 'wyrm_quest_complete',
        description: 'Mark a task as completed',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            questId: {
              type: 'number',
              description: 'Quest ID to complete',
            },
            title: {
              type: 'string',
              description: 'Quest title (if ID not known)',
            },
          },
          required: ['projectPath'],
        },
      },
      {
        name: 'wyrm_sync',
        description: 'Sync database with .wyrm folder (import/export)',
        inputSchema: {
          type: 'object',
          properties: {
            projectPath: {
              type: 'string',
              description: 'Absolute path to the project root',
            },
            direction: {
              type: 'string',
              enum: ['import', 'export', 'both'],
              description: 'Sync direction',
            },
          },
          required: ['projectPath'],
        },
      },
      {
        name: 'wyrm_stats',
        description: 'Get Wyrm statistics',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  
  try {
    switch (name) {
      case 'wyrm_context': {
        const { projectPath, maxTokens = 4000 } = args as { projectPath: string; maxTokens?: number };
        
        // Try to import from .wyrm folder first
        try {
          sync.importFromFolder(projectPath);
        } catch {
          // No .wyrm folder, that's ok
        }
        
        const project = db.getProject(projectPath);
        if (!project) {
          return {
            content: [{ type: 'text', text: `No project registered at ${projectPath}. Use wyrm_session_start to initialize.` }],
          };
        }
        
        const context = db.getAllContext(project.id);
        const sessions = db.getRecentSessions(project.id, 5);
        const quests = db.getPendingQuests(project.id);
        
        const bundle = createContextBundle(
          project,
          context,
          sessions,
          quests.map(q => ({ title: q.title, priority: q.priority })),
          maxTokens
        );
        
        return {
          content: [{ type: 'text', text: bundle }],
        };
      }
      
      case 'wyrm_session_start': {
        const { projectPath, objectives } = args as { projectPath: string; objectives?: string };
        
        // Register project if not exists
        const projectName = projectPath.split('/').pop() || 'Unknown';
        const project = db.registerProject(projectName, projectPath);
        
        // Get or create today's session
        let session = db.getTodaySession(project.id);
        if (!session) {
          session = db.createSession(project.id, { objectives });
        } else if (objectives) {
          session = db.updateSession(session.id, { objectives });
        }
        
        // Archive old sessions to keep memory bounded
        const archived = db.archiveOldSessions(project.id, 10);
        
        return {
          content: [{
            type: 'text',
            text: `Session started for ${project.name} (${session.date}).\n` +
                  `Objectives: ${session.objectives || 'None set'}\n` +
                  `${archived > 0 ? `Archived ${archived} old sessions.` : ''}`,
          }],
        };
      }
      
      case 'wyrm_session_update': {
        const { projectPath, completed, issues, commits, filesChanged, notes } = args as {
          projectPath: string;
          completed?: string;
          issues?: string;
          commits?: string;
          filesChanged?: string;
          notes?: string;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: 'text', text: 'Project not found. Run wyrm_session_start first.' }] };
        }
        
        let session = db.getTodaySession(project.id);
        if (!session) {
          session = db.createSession(project.id, {});
        }
        
        // Append to existing values
        const updates: Record<string, string> = {};
        if (completed) updates.completed = session.completed ? `${session.completed}\n${completed}` : completed;
        if (issues) updates.issues = session.issues ? `${session.issues}\n${issues}` : issues;
        if (commits) updates.commits = session.commits ? `${session.commits}\n${commits}` : commits;
        if (filesChanged) updates.files_changed = session.files_changed ? `${session.files_changed}\n${filesChanged}` : filesChanged;
        if (notes) updates.notes = session.notes ? `${session.notes}\n${notes}` : notes;
        
        session = db.updateSession(session.id, updates);
        
        // Generate summary
        const summary = summarizeSession(session);
        db.updateSession(session.id, { summary: summary.summary });
        
        // Sync to .wyrm folder
        try {
          sync.exportToFolder(projectPath);
        } catch {
          // No .wyrm folder, skip
        }
        
        return {
          content: [{ type: 'text', text: `Session updated. Summary: ${summary.summary}` }],
        };
      }
      
      case 'wyrm_quest_add': {
        const { projectPath, title, description, priority = 'medium' } = args as {
          projectPath: string;
          title: string;
          description?: string;
          priority?: 'critical' | 'high' | 'medium' | 'low';
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: 'text', text: 'Project not found.' }] };
        }
        
        const quest = db.addQuest(project.id, title, description, priority);
        
        // Sync to .wyrm folder
        try {
          sync.exportToFolder(projectPath);
        } catch {
          // Skip if no .wyrm folder
        }
        
        return {
          content: [{ type: 'text', text: `Quest added: [${quest.priority}] ${quest.title} (ID: ${quest.id})` }],
        };
      }
      
      case 'wyrm_quest_complete': {
        const { projectPath, questId, title } = args as { projectPath: string; questId?: number; title?: string };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: 'text', text: 'Project not found.' }] };
        }
        
        let id = questId;
        if (!id && title) {
          const quests = db.getPendingQuests(project.id);
          const found = quests.find(q => q.title.toLowerCase().includes(title.toLowerCase()));
          if (found) id = found.id;
        }
        
        if (!id) {
          return { content: [{ type: 'text', text: 'Quest not found.' }] };
        }
        
        const quest = db.updateQuest(id, 'completed');
        
        // Sync to .wyrm folder
        try {
          sync.exportToFolder(projectPath);
        } catch {
          // Skip if no .wyrm folder
        }
        
        return {
          content: [{ type: 'text', text: `Quest completed: ${quest.title}` }],
        };
      }
      
      case 'wyrm_sync': {
        const { projectPath, direction = 'both' } = args as { projectPath: string; direction?: string };
        
        let result = '';
        
        if (direction === 'import' || direction === 'both') {
          try {
            const project = sync.importFromFolder(projectPath);
            result += `Imported from .wyrm folder for ${project.name}. `;
          } catch (e) {
            result += `Import failed: ${e}. `;
          }
        }
        
        if (direction === 'export' || direction === 'both') {
          try {
            sync.exportToFolder(projectPath);
            result += `Exported to .wyrm folder. `;
          } catch (e) {
            result += `Export failed: ${e}. `;
          }
        }
        
        return { content: [{ type: 'text', text: result }] };
      }
      
      case 'wyrm_stats': {
        const stats = db.getStats();
        return {
          content: [{
            type: 'text',
            text: `Wyrm Stats:\n- Projects: ${stats.projects}\n- Sessions: ${stats.sessions}\n- Quests: ${stats.quests}`,
          }],
        };
      }
      
      default:
        return { content: [{ type: 'text', text: `Unknown tool: ${name}` }] };
    }
  } catch (error) {
    return {
      content: [{ type: 'text', text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
      isError: true,
    };
  }
});

// List resources
server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const stats = db.getStats();
  
  return {
    resources: [
      {
        uri: 'wyrm://stats',
        name: 'Wyrm Statistics',
        description: `${stats.projects} projects, ${stats.sessions} sessions, ${stats.quests} quests`,
        mimeType: 'text/plain',
      },
    ],
  };
});

// Read resources
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const { uri } = request.params;
  
  if (uri === 'wyrm://stats') {
    const stats = db.getStats();
    return {
      contents: [{
        uri,
        mimeType: 'text/plain',
        text: JSON.stringify(stats, null, 2),
      }],
    };
  }
  
  return { contents: [] };
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Wyrm MCP Server started');
}

main().catch(console.error);
