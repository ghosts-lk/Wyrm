#!/usr/bin/env node
/**
 * Wyrm MCP Server - Model Context Protocol for AI memory
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * 
 * Features:
 * - Auto-discovery of projects in watched directories
 * - Multi-project tracking with unified context
 * - Data lake for large dataset storage
 * - Full-text search across all data
 * - Prompt caching with cache_control hints (saves credits on Claude, etc.)
 * - In-memory response cache for read-only tools
 * - Usage tracking for token/cost monitoring
 * - Compact responses to minimize token burn
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { WyrmDB } from "./database.js";
import { WyrmSync } from "./sync.js";
import { summarizeSession, createContextBundle } from "./summarizer.js";
import { detectClients, autoConfigureAll, removeFromAll, getStatusSummary, findWyrmServerPath, getDefaultDbPath } from "./autoconfig.js";
import { cache, compactProject, compactQuest, compactSession, estimateTokens, guardSize } from "./performance.js";
import { createHash } from "crypto";

const db = new WyrmDB();
const sync = new WyrmSync(db);

// ==================== USAGE TRACKING ====================
interface UsageEntry {
  tool: string;
  tokens_in: number;
  tokens_out: number;
  cached: boolean;
  ms: number;
  timestamp: string;
}

const usageLog: UsageEntry[] = [];
const USAGE_MAX_ENTRIES = 500;

function trackUsage(entry: UsageEntry): void {
  usageLog.push(entry);
  if (usageLog.length > USAGE_MAX_ENTRIES) {
    usageLog.splice(0, usageLog.length - USAGE_MAX_ENTRIES);
  }
}

function getUsageStats(last?: number): {
  totalCalls: number;
  cachedCalls: number;
  cacheHitRate: string;
  totalTokensIn: number;
  totalTokensOut: number;
  tokensSaved: number;
  avgResponseMs: number;
  topTools: { tool: string; calls: number; tokens: number }[];
} {
  const entries = last ? usageLog.slice(-last) : usageLog;
  const cachedEntries = entries.filter(e => e.cached);
  const toolMap = new Map<string, { calls: number; tokens: number }>();
  
  let totalTokensIn = 0, totalTokensOut = 0, tokensSaved = 0, totalMs = 0;
  
  for (const e of entries) {
    totalTokensIn += e.tokens_in;
    totalTokensOut += e.tokens_out;
    totalMs += e.ms;
    if (e.cached) tokensSaved += e.tokens_out;
    
    const existing = toolMap.get(e.tool) || { calls: 0, tokens: 0 };
    existing.calls++;
    existing.tokens += e.tokens_out;
    toolMap.set(e.tool, existing);
  }
  
  const topTools = [...toolMap.entries()]
    .map(([tool, data]) => ({ tool, ...data }))
    .sort((a, b) => b.tokens - a.tokens)
    .slice(0, 10);
  
  return {
    totalCalls: entries.length,
    cachedCalls: cachedEntries.length,
    cacheHitRate: entries.length > 0 
      ? `${((cachedEntries.length / entries.length) * 100).toFixed(1)}%` 
      : '0%',
    totalTokensIn,
    totalTokensOut,
    tokensSaved,
    avgResponseMs: entries.length > 0 ? Math.round(totalMs / entries.length) : 0,
    topTools,
  };
}

// ==================== RESPONSE HELPERS ====================

// Response fingerprints for delta detection
const responseFingerprints = new Map<string, string>();

function fingerprint(data: string): string {
  return createHash('md5').update(data).digest('hex').slice(0, 12);
}

/** Wrap response with cache_control hint for Anthropic prompt caching */
function cachedResponse(text: string, ephemeral = false) {
  return {
    content: [{
      type: "text" as const,
      text,
      // MCP cache_control hint — tells Claude to cache this content block
      // "ephemeral" = cache for the duration of the conversation
      ...(ephemeral ? {} : { _meta: { cacheControl: { type: "ephemeral" } } }),
    }],
    // Top-level _meta for SDK-level cache hints
    _meta: {
      cacheControl: { type: "ephemeral" },
    },
  };
}

/** Read-only tools that benefit from caching */
const READ_ONLY_TOOLS = new Set([
  "wyrm_list_projects",
  "wyrm_project_context",
  "wyrm_global_context",
  "wyrm_all_quests",
  "wyrm_data_query",
  "wyrm_data_categories",
  "wyrm_search",
  "wyrm_stats",
]);

/** Tools that mutate data — invalidate relevant caches */
const WRITE_TOOLS = new Set([
  "wyrm_session_start",
  "wyrm_session_update",
  "wyrm_quest_add",
  "wyrm_quest_complete",
  "wyrm_data_insert",
  "wyrm_data_batch_insert",
  "wyrm_set_global",
  "wyrm_scan_projects",
  "wyrm_sync",
  "wyrm_maintenance",
]);

const server = new Server(
  {
    name: "wyrm",
    version: "3.1.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// Tool definitions
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    // Project Management
    {
      name: "wyrm_scan_projects",
      description: "Scan a directory for git projects and register them. Use this to auto-discover all projects.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Directory path to scan (e.g., /home/user/Git Projects)" },
          watch: { type: "boolean", description: "Add to watch list for future auto-scans" },
          recursive: { type: "boolean", description: "Scan subdirectories recursively" },
        },
        required: ["path"],
      },
    },
    {
      name: "wyrm_list_projects",
      description: "List all registered projects with their status",
      inputSchema: {
        type: "object",
        properties: {
          search: { type: "string", description: "Search query to filter projects" },
          limit: { type: "number", description: "Max projects to return" },
        },
      },
    },
    {
      name: "wyrm_project_context",
      description: "Get full context for a specific project including recent sessions, quests, and stored context",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          projectName: { type: "string", description: "Or project name" },
        },
      },
    },
    // Multi-Project Overview
    {
      name: "wyrm_global_context",
      description: "Get overview of all projects, pending quests across projects, and global context",
      inputSchema: {
        type: "object",
        properties: {
          includeQuests: { type: "boolean", description: "Include all pending quests" },
          maxProjects: { type: "number", description: "Max projects to include" },
        },
      },
    },
    // Session Management
    {
      name: "wyrm_session_start",
      description: "Start or continue a session for a project",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          objectives: { type: "string", description: "Session objectives" },
        },
        required: ["projectPath"],
      },
    },
    {
      name: "wyrm_session_update",
      description: "Update the current session with completed work, issues, or notes",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          completed: { type: "string", description: "What was completed" },
          issues: { type: "string", description: "Any issues encountered" },
          commits: { type: "string", description: "Git commits made" },
          notes: { type: "string", description: "Additional notes" },
        },
        required: ["projectPath"],
      },
    },
    // Quest Management
    {
      name: "wyrm_quest_add",
      description: "Add a quest (task) to a project",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          title: { type: "string", description: "Quest title" },
          description: { type: "string", description: "Quest description" },
          priority: { type: "string", enum: ["critical", "high", "medium", "low"] },
          tags: { type: "string", description: "Comma-separated tags" },
        },
        required: ["projectPath", "title"],
      },
    },
    {
      name: "wyrm_quest_complete",
      description: "Mark a quest as completed",
      inputSchema: {
        type: "object",
        properties: {
          questId: { type: "number", description: "Quest ID" },
        },
        required: ["questId"],
      },
    },
    {
      name: "wyrm_all_quests",
      description: "Get all pending quests across all projects",
      inputSchema: {
        type: "object",
        properties: {
          priority: { type: "string", enum: ["critical", "high", "medium", "low"], description: "Filter by priority" },
        },
      },
    },
    // Data Lake Operations
    {
      name: "wyrm_data_insert",
      description: "Insert data into the data lake for a project",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          category: { type: "string", description: "Data category (e.g., 'logs', 'metrics', 'artifacts')" },
          key: { type: "string", description: "Data key/identifier" },
          value: { type: "string", description: "Data value (can be JSON string)" },
          metadata: { type: "object", description: "Optional metadata object" },
        },
        required: ["projectPath", "category", "key", "value"],
      },
    },
    {
      name: "wyrm_data_batch_insert",
      description: "Batch insert multiple data points efficiently",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          data: {
            type: "array",
            items: {
              type: "object",
              properties: {
                category: { type: "string" },
                key: { type: "string" },
                value: { type: "string" },
                metadata: { type: "object" },
              },
              required: ["category", "key", "value"],
            },
          },
        },
        required: ["projectPath", "data"],
      },
    },
    {
      name: "wyrm_data_query",
      description: "Query data from the data lake",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
          category: { type: "string", description: "Filter by category" },
          search: { type: "string", description: "Full-text search query" },
          limit: { type: "number", description: "Max results" },
          offset: { type: "number", description: "Offset for pagination" },
        },
        required: ["projectPath"],
      },
    },
    {
      name: "wyrm_data_categories",
      description: "List all data categories for a project",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Project path" },
        },
        required: ["projectPath"],
      },
    },
    // Global Context
    {
      name: "wyrm_set_global",
      description: "Set global context that applies across all projects",
      inputSchema: {
        type: "object",
        properties: {
          key: { type: "string", description: "Context key" },
          value: { type: "string", description: "Context value" },
        },
        required: ["key", "value"],
      },
    },
    // Search
    {
      name: "wyrm_search",
      description: "Search across all projects, sessions, quests, and data",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          type: { type: "string", enum: ["all", "sessions", "quests", "data"], description: "What to search" },
          projectPath: { type: "string", description: "Limit to specific project" },
        },
        required: ["query"],
      },
    },
    // Sync & Maintenance
    {
      name: "wyrm_sync",
      description: "Sync database with .wyrm folders in all projects",
      inputSchema: {
        type: "object",
        properties: {
          projectPath: { type: "string", description: "Sync specific project, or all if not specified" },
          direction: { type: "string", enum: ["import", "export", "both"], description: "Sync direction" },
        },
      },
    },
    {
      name: "wyrm_stats",
      description: "Get Wyrm database statistics",
      inputSchema: {
        type: "object",
        properties: {},
      },
    },
    {
      name: "wyrm_maintenance",
      description: "Run database maintenance (vacuum, archive old sessions)",
      inputSchema: {
        type: "object",
        properties: {
          vacuum: { type: "boolean", description: "Run vacuum to reclaim space" },
          archiveDays: { type: "number", description: "Archive sessions older than N days" },
        },
      },
    },
    // Usage & Cost Tracking
    {
      name: "wyrm_usage",
      description: "View token usage stats, cache hit rates, and estimated cost savings. Helps monitor and optimize AI credit consumption.",
      inputSchema: {
        type: "object",
        properties: {
          last: { type: "number", description: "Show stats for last N calls (default: all)" },
          reset: { type: "boolean", description: "Reset usage counters" },
        },
      },
    },
    // Auto-Configure
    {
      name: "wyrm_setup",
      description: "Auto-detect installed AI clients (VS Code, Claude Desktop, Cursor, Windsurf, Zed) and configure Wyrm's MCP server in all of them. Run this to connect Wyrm to a new AI or after switching providers.",
      inputSchema: {
        type: "object",
        properties: {
          action: { type: "string", enum: ["configure", "check", "remove"], description: "Action: configure (default), check status, or remove from all" },
          serverPath: { type: "string", description: "Override Wyrm server path (auto-detected if empty)" },
          dbPath: { type: "string", description: "Override database path (default: ~/.wyrm/wyrm.db)" },
        },
      },
    },
  ],
}));

// Tool implementations
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const startTime = performance.now();
  const argsStr = JSON.stringify(args || {});
  const tokensIn = estimateTokens(argsStr);
  
  // Cache key for read-only tools
  const cacheKey = READ_ONLY_TOOLS.has(name) ? `${name}:${argsStr}` : null;
  
  // Check in-memory cache for read-only tools
  if (cacheKey) {
    const cached = cache.get<{ content: Array<{ type: string; text: string }> }>(cacheKey);
    if (cached) {
      const ms = Math.round(performance.now() - startTime);
      const tokensOut = estimateTokens(JSON.stringify(cached));
      trackUsage({ tool: name, tokens_in: tokensIn, tokens_out: tokensOut, cached: true, ms, timestamp: new Date().toISOString() });
      
      // Return cached response with cache_control hints
      return {
        ...cached,
        _meta: { cacheControl: { type: "ephemeral" } },
      };
    }
  }
  
  // Invalidate caches on write operations
  if (WRITE_TOOLS.has(name)) {
    const projectPath = (args as any)?.projectPath;
    if (projectPath) {
      // Invalidate project-specific caches
      cache.invalidate(projectPath);
    }
    // Invalidate global caches
    cache.invalidate('wyrm_list_projects');
    cache.invalidate('wyrm_global_context');
    cache.invalidate('wyrm_all_quests');
    cache.invalidate('wyrm_stats');
  }

  let result: any;

  try {
    result = await (async () => {
    switch (name) {
      // ==================== PROJECT MANAGEMENT ====================
      case "wyrm_scan_projects": {
        const { path, watch, recursive } = args as { path: string; watch?: boolean; recursive?: boolean };
        
        if (watch) {
          db.addWatchDir(path, recursive !== false);
        }
        
        const projects = db.scanForProjects(path, recursive !== false);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Scanned ${path}\n\nDiscovered ${projects.length} projects:\n${
              projects.map(p => `- ${p.name} (${p.stack || 'unknown'}) - ${p.branch || 'no branch'}`).join('\n')
            }${watch ? '\n\nAdded to watch list for future auto-scans.' : ''}`
          }]
        };
      }

      case "wyrm_list_projects": {
        const { search, limit } = args as { search?: string; limit?: number };
        
        const projects = search 
          ? db.searchProjects(search)
          : db.getAllProjects(limit || 50);
        
        const projectList = projects.map(p => {
          const stats = db.getProjectStats(p.id);
          return `## ${p.name}\n` +
            `- **Path:** ${p.path}\n` +
            `- **Stack:** ${p.stack || 'unknown'}\n` +
            `- **Branch:** ${p.branch || 'N/A'}\n` +
            `- **Sessions:** ${stats.sessions} | **Quests:** ${stats.quests.pending}p/${stats.quests.completed}c\n` +
            `- **Data:** ${stats.dataPoints}`;
        }).join('\n\n');
        
        const response = cachedResponse(`🐉 **${projects.length} Projects**\n\n${projectList}`);
        if (cacheKey) cache.set(cacheKey, response, 60000); // 60s TTL
        return response;
      }

      case "wyrm_project_context": {
        const { projectPath, projectName } = args as { projectPath?: string; projectName?: string };
        
        let project = projectPath ? db.getProject(projectPath) : undefined;
        if (!project && projectName) {
          project = db.getProjectByName(projectName);
        }
        
        if (!project) {
          return { content: [{ type: "text", text: "Project not found. Run wyrm_scan_projects first." }] };
        }
        
        // Gather data for context bundle
        const recentSessions = db.getRecentSessions(project.id, 10);
        const quests = db.getPendingQuests(project.id).map(q => ({ title: q.title, priority: q.priority }));
        const currentContext = db.getAllContext(project.id);
        
        const context = createContextBundle(
          { name: project.name, stack: project.stack },
          currentContext,
          recentSessions,
          quests
        );
        
        const response = cachedResponse(`🐉 **Context for ${project.name}**\n\n${context}`);
        if (cacheKey) cache.set(cacheKey, response, 30000); // 30s TTL — context changes more often
        return response;
      }

      // ==================== GLOBAL CONTEXT ====================
      case "wyrm_global_context": {
        const { includeQuests, maxProjects } = args as { includeQuests?: boolean; maxProjects?: number };
        
        const projects = db.getAllProjects(maxProjects || 20);
        const globalContext = db.getAllGlobalContext();
        
        let text = `🐉 **Wyrm Global Overview**\n\n`;
        
        // Global context
        if (Object.keys(globalContext).length > 0) {
          text += `## Global Context\n`;
          for (const [key, value] of Object.entries(globalContext)) {
            text += `- **${key}:** ${value.slice(0, 200)}${value.length > 200 ? '...' : ''}\n`;
          }
          text += '\n';
        }
        
        // Projects summary
        text += `## Projects (${projects.length})\n`;
        for (const p of projects) {
          const stats = db.getProjectStats(p.id);
          text += `- **${p.name}** (${p.stack || '?'}) - ${stats.quests.pending} quests, ${stats.sessions} sessions\n`;
        }
        text += '\n';
        
        // All pending quests
        if (includeQuests) {
          const allQuests = db.getAllPendingQuests();
          text += `## All Pending Quests (${allQuests.length})\n`;
          for (const q of allQuests.slice(0, 20)) {
            const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[q.priority];
            text += `- ${emoji} [${(q as any).project_name}] ${q.title}\n`;
          }
        }
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 45000); // 45s TTL
        return response;
      }

      // ==================== SESSIONS ====================
      case "wyrm_session_start": {
        const { projectPath, objectives } = args as { projectPath: string; objectives?: string };
        
        let project = db.getProject(projectPath);
        if (!project) {
          // Auto-register project
          const { basename } = await import('path');
          project = db.registerProject(basename(projectPath), projectPath);
        }
        
        let session = db.getTodaySession(project.id);
        if (!session) {
          session = db.createSession(project.id, { objectives: objectives || '' });
        } else if (objectives) {
          session = db.updateSession(session.id, { 
            objectives: session.objectives ? `${session.objectives}\n${objectives}` : objectives 
          });
        }
        
        // Archive old sessions
        db.archiveOldSessions(project.id, 10);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Session ${session.id} for ${project.name}\n` +
              `**Date:** ${session.date}\n` +
              `**Objectives:** ${session.objectives || 'None set'}`
          }]
        };
      }

      case "wyrm_session_update": {
        const { projectPath, completed, issues, commits, notes } = args as {
          projectPath: string;
          completed?: string;
          issues?: string;
          commits?: string;
          notes?: string;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        let session = db.getTodaySession(project.id);
        if (!session) {
          session = db.createSession(project.id, {});
        }
        
        const updates: any = {};
        if (completed) updates.completed = session.completed ? `${session.completed}\n${completed}` : completed;
        if (issues) updates.issues = session.issues ? `${session.issues}\n${issues}` : issues;
        if (commits) updates.commits = session.commits ? `${session.commits}\n${commits}` : commits;
        if (notes) updates.notes = session.notes ? `${session.notes}\n${notes}` : notes;
        
        session = db.updateSession(session.id, updates);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Session updated for ${project.name}`
          }]
        };
      }

      // ==================== QUESTS ====================
      case "wyrm_quest_add": {
        const { projectPath, title, description, priority, tags } = args as {
          projectPath: string;
          title: string;
          description?: string;
          priority?: 'critical' | 'high' | 'medium' | 'low';
          tags?: string;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        const quest = db.addQuest(project.id, title, description, priority || 'medium', tags);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Quest #${quest.id} added: ${title}`
          }]
        };
      }

      case "wyrm_quest_complete": {
        const { questId } = args as { questId: number };
        const quest = db.updateQuest(questId, 'completed');
        
        return {
          content: [{
            type: "text",
            text: `🐉 Quest #${questId} completed: ${quest.title}`
          }]
        };
      }

      case "wyrm_all_quests": {
        const { priority } = args as { priority?: string };
        let quests = db.getAllPendingQuests();
        
        if (priority) {
          quests = quests.filter(q => q.priority === priority);
        }
        
        const text = quests.map(q => {
          const emoji = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[q.priority];
          return `${emoji} [${(q as any).project_name}] #${q.id}: ${q.title}`;
        }).join('\n');
        
        const response = cachedResponse(`🐉 **${quests.length} Pending Quests**\n\n${text}`);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      // ==================== DATA LAKE ====================
      case "wyrm_data_insert": {
        const { projectPath, category, key, value, metadata } = args as {
          projectPath: string;
          category: string;
          key: string;
          value: string;
          metadata?: Record<string, unknown>;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        const dataPoint = db.insertData(project.id, category, key, value, metadata);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Data inserted: ${category}/${key} (ID: ${dataPoint.id})`
          }]
        };
      }

      case "wyrm_data_batch_insert": {
        const { projectPath, data } = args as {
          projectPath: string;
          data: Array<{ category: string; key: string; value: string; metadata?: Record<string, unknown> }>;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        const items = data.map(d => ({ ...d, projectId: project.id }));
        const count = db.insertDataBatch(items);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Batch inserted ${count} data points`
          }]
        };
      }

      case "wyrm_data_query": {
        const { projectPath, category, search, limit, offset } = args as {
          projectPath: string;
          category?: string;
          search?: string;
          limit?: number;
          offset?: number;
        };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        let results;
        if (search) {
          results = db.searchData(search, project.id);
        } else {
          results = db.queryData(project.id, category, limit || 100, offset || 0);
        }
        
        const text = results.slice(0, 50).map(d => 
          `- **${d.category}/${d.key}:** ${d.value.slice(0, 100)}${d.value.length > 100 ? '...' : ''}`
        ).join('\n');
        
        const response = cachedResponse(`🐉 **${results.length} Results**\n\n${text}`);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      case "wyrm_data_categories": {
        const { projectPath } = args as { projectPath: string };
        
        const project = db.getProject(projectPath);
        if (!project) {
          return { content: [{ type: "text", text: "Project not found" }] };
        }
        
        const categories = db.getDataCategories(project.id);
        const text = categories.map(c => `- ${c.category}: ${c.count} items`).join('\n');
        
        const response = cachedResponse(`🐉 **Data Categories for ${project.name}**\n\n${text}`);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      // ==================== GLOBAL CONTEXT ====================
      case "wyrm_set_global": {
        const { key, value } = args as { key: string; value: string };
        db.setGlobalContext(key, value);
        
        return {
          content: [{
            type: "text",
            text: `🐉 Global context set: ${key}`
          }]
        };
      }

      // ==================== SEARCH ====================
      case "wyrm_search": {
        const { query, type, projectPath } = args as {
          query: string;
          type?: 'all' | 'sessions' | 'quests' | 'data';
          projectPath?: string;
        };
        
        const project = projectPath ? db.getProject(projectPath) : undefined;
        const projectId = project?.id;
        const searchType = type || 'all';
        
        let text = `🐉 **Search Results for "${query}"**\n\n`;
        
        if (searchType === 'all' || searchType === 'sessions') {
          const sessions = db.searchSessions(query, projectId);
          if (sessions.length > 0) {
            text += `## Sessions (${sessions.length})\n`;
            for (const s of sessions.slice(0, 10)) {
              text += `- ${s.date}: ${s.objectives?.slice(0, 80) || s.completed?.slice(0, 80) || 'No info'}...\n`;
            }
            text += '\n';
          }
        }
        
        if (searchType === 'all' || searchType === 'quests') {
          const quests = db.searchQuests(query);
          if (quests.length > 0) {
            text += `## Quests (${quests.length})\n`;
            for (const q of quests.slice(0, 10)) {
              text += `- #${q.id}: ${q.title}\n`;
            }
            text += '\n';
          }
        }
        
        if (searchType === 'all' || searchType === 'data') {
          const data = db.searchData(query, projectId);
          if (data.length > 0) {
            text += `## Data (${data.length})\n`;
            for (const d of data.slice(0, 10)) {
              text += `- ${d.category}/${d.key}\n`;
            }
          }
        }
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 20000); // 20s — search results change
        return response;
      }

      // ==================== SYNC & MAINTENANCE ====================
      case "wyrm_sync": {
        const { projectPath, direction } = args as {
          projectPath?: string;
          direction?: 'import' | 'export' | 'both';
        };
        
        const dir = direction || 'both';
        let count = 0;
        
        if (projectPath) {
          const project = db.getProject(projectPath);
          if (project) {
            if (dir === 'import' || dir === 'both') sync.importFromFolder(projectPath);
            if (dir === 'export' || dir === 'both') sync.exportToFolder(projectPath);
            count = 1;
          }
        } else {
          const projects = db.getAllProjects(1000);
          for (const p of projects) {
            try {
              if (dir === 'import' || dir === 'both') sync.importFromFolder(p.path);
              if (dir === 'export' || dir === 'both') sync.exportToFolder(p.path);
              count++;
            } catch {
              // Skip failed syncs
            }
          }
        }
        
        return {
          content: [{
            type: "text",
            text: `🐉 Synced ${count} project(s)`
          }]
        };
      }

      case "wyrm_stats": {
        const stats = db.getStats();
        const cacheStats = cache.stats();
        const usage = getUsageStats();
        
        const response = cachedResponse(
          `🐉 **Wyrm Statistics**\n\n` +
          `- **Projects:** ${stats.projects}\n` +
          `- **Sessions:** ${stats.sessions}\n` +
          `- **Quests:** ${stats.quests}\n` +
          `- **Data Points:** ${stats.dataPoints}\n` +
          `- **Active Tokens:** ~${stats.totalTokens.toLocaleString()}\n` +
          `- **Database Size:** ${stats.dbSize}\n\n` +
          `**Cache:** ${cacheStats.size} entries | Hit rate: ${usage.cacheHitRate}\n` +
          `**Usage:** ${usage.totalCalls} calls | ~${usage.tokensSaved.toLocaleString()} tokens saved by cache`
        );
        if (cacheKey) cache.set(cacheKey, response, 15000);
        return response;
      }

      case "wyrm_maintenance": {
        const { vacuum, archiveDays } = args as { vacuum?: boolean; archiveDays?: number };
        
        let text = '🐉 **Maintenance Complete**\n\n';
        
        if (archiveDays) {
          const projects = db.getAllProjects(1000);
          let archived = 0;
          for (const p of projects) {
            archived += db.archiveOldSessions(p.id, archiveDays);
          }
          text += `- Archived ${archived} old sessions\n`;
        }
        
        if (vacuum) {
          db.vacuum();
          text += `- Vacuumed database\n`;
        }
        
        db.checkpoint();
        text += `- Checkpointed WAL\n`;
        
        const stats = db.getStats();
        text += `\n**New Database Size:** ${stats.dbSize}`;
        
        return { content: [{ type: "text", text }] };
      }

      case "wyrm_setup": {
        const { action, serverPath, dbPath } = args as {
          action?: string;
          serverPath?: string;
          dbPath?: string;
        };

        const setupAction = action || 'configure';

        if (setupAction === 'check') {
          return {
            content: [{
              type: "text",
              text: getStatusSummary()
            }]
          };
        }

        if (setupAction === 'remove') {
          const results = removeFromAll();
          const removed = results.filter(r => r.action === 'configured');
          const text = `🐉 **Wyrm Removed**\n\n` +
            `Removed from ${removed.length} AI client(s):\n` +
            results.map(r => `- ${r.client.icon} ${r.client.name}: ${r.message}`).join('\n') +
            `\n\nRun wyrm_setup again to reconnect.`;
          return { content: [{ type: "text", text }] };
        }

        // Default: configure
        const results = autoConfigureAll({
          serverPath: serverPath || undefined,
          dbPath: dbPath || undefined,
        });

        const configured = results.filter(r => r.action === 'configured' || r.action === 'updated');
        const failed = results.filter(r => r.action === 'failed');

        let text = `🐉 **Wyrm Auto-Configure Complete**\n\n`;
        text += `Connected to ${configured.length} AI client(s):\n`;
        
        for (const r of results) {
          const icon = r.action === 'configured' ? '✅' :
                       r.action === 'updated' ? '🔄' :
                       r.action === 'skipped' ? '○' : '❌';
          text += `- ${icon} ${r.client.icon} ${r.client.name}: ${r.message}\n`;
        }

        if (failed.length > 0) {
          text += `\n⚠️ ${failed.length} client(s) failed. Check errors above.`;
        }

        text += `\n\nServer: ${findWyrmServerPath()}\nDB: ${getDefaultDbPath()}`;
        text += `\n\n_Switch AIs anytime — run wyrm_setup again to reconnect._`;

        return { content: [{ type: "text", text }] };
      }

      // ==================== USAGE TRACKING ====================
      case "wyrm_usage": {
        const { last, reset } = args as { last?: number; reset?: boolean };
        
        if (reset) {
          usageLog.length = 0;
          responseFingerprints.clear();
          cache.invalidate();
          return { content: [{ type: "text", text: "🐉 Usage counters reset, caches cleared." }] };
        }
        
        const usage = getUsageStats(last);
        const cacheStats = cache.stats();
        
        let text = `🐉 **Wyrm Usage Report**\n\n`;
        text += `## Overview${last ? ` (last ${last} calls)` : ''}\n`;
        text += `- **Total Calls:** ${usage.totalCalls}\n`;
        text += `- **Cache Hits:** ${usage.cachedCalls} (${usage.cacheHitRate})\n`;
        text += `- **Tokens In:** ~${usage.totalTokensIn.toLocaleString()}\n`;
        text += `- **Tokens Out:** ~${usage.totalTokensOut.toLocaleString()}\n`;
        text += `- **Tokens Saved (cache):** ~${usage.tokensSaved.toLocaleString()}\n`;
        text += `- **Avg Response:** ${usage.avgResponseMs}ms\n`;
        text += `- **Active Cache Entries:** ${cacheStats.size}\n\n`;
        
        if (usage.topTools.length > 0) {
          text += `## Top Tools by Token Usage\n`;
          for (const t of usage.topTools) {
            text += `- **${t.tool}:** ${t.calls} calls, ~${t.tokens.toLocaleString()} tokens\n`;
          }
          text += '\n';
        }
        
        // Cost estimate (Claude Opus pricing: $15/M input, $75/M output)
        const costInput = (usage.totalTokensIn / 1_000_000) * 15;
        const costOutput = (usage.totalTokensOut / 1_000_000) * 75;
        const costSaved = (usage.tokensSaved / 1_000_000) * 75;
        
        text += `## Estimated Cost (Claude Opus rates)\n`;
        text += `- **Input:** $${costInput.toFixed(4)}\n`;
        text += `- **Output:** $${costOutput.toFixed(4)}\n`;
        text += `- **Saved by cache:** $${costSaved.toFixed(4)}\n`;
        text += `- **Net cost:** $${(costInput + costOutput - costSaved).toFixed(4)}`;
        
        return cachedResponse(text, true); // ephemeral — don't cache the usage report itself
      }

      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
    })();
    
    // Track usage for all non-cached responses
    const ms = Math.round(performance.now() - startTime);
    const tokensOut = estimateTokens(JSON.stringify(result));
    trackUsage({ tool: name, tokens_in: tokensIn, tokens_out: tokensOut, cached: false, ms, timestamp: new Date().toISOString() });
    
    return result;
  } catch (error) {
    const ms = Math.round(performance.now() - startTime);
    trackUsage({ tool: name, tokens_in: tokensIn, tokens_out: 0, cached: false, ms, timestamp: new Date().toISOString() });
    return {
      content: [{ type: "text", text: `Error: ${error}` }],
      isError: true,
    };
  }
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
