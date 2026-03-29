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
import { getGlobalOrchestrator, initializeOrchestrator, classifyTask, getDefaultConfig, type OrchestrationConfig, type TaskType } from "./auto-orchestrator.js";

const db = new WyrmDB();
const sync = new WyrmSync(db);

// ==================== AUTO-ORCHESTRATION ====================
const orchestrator = initializeOrchestrator({
  autoOrchestrateEnabled: true,
  minConfidenceThreshold: 65,
  maxParallelAgents: 6,
  defaultHaikuBoosting: true,
  trackMetrics: true,
});

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
  "wyrm_skill_list",
  "wyrm_skill_get",
  "wyrm_skill_search",
  "wyrm_skill_stats",
  "wyrm_orchestration_config",
  "wyrm_orchestration_stats",
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
  "wyrm_skill_register",
  "wyrm_skill_delete",
  "wyrm_skill_activate",
  "wyrm_skill_deactivate",
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
    // Skill Management
    {
      name: "wyrm_skill_register",
      description: "Register or update a skill and store metadata in Wyrm",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name (e.g., 'professional-lead-scraping')" },
          description: { type: "string", description: "Skill description" },
          skillPath: { type: "string", description: "File path to skill (e.g., ~/.copilot/skills/name or project relative path)" },
          category: { type: "string", description: "Skill category (e.g., 'data-extraction', 'testing', 'documentation')" },
          author: { type: "string", description: "Skill author or creator" },
          version: { type: "string", description: "Skill version" },
          tags: { type: "string", description: "Comma-separated tags (e.g., 'scraping,leads,email-validation')" },
        },
        required: ["name", "description", "skillPath"],
      },
    },
    {
      name: "wyrm_skill_list",
      description: "List registered skills with filtering options",
      inputSchema: {
        type: "object",
        properties: {
          active: { type: "boolean", description: "Filter by active status" },
          category: { type: "string", description: "Filter by category" },
          search: { type: "string", description: "Full-text search by name, description, or tags" },
        },
      },
    },
    {
      name: "wyrm_skill_get",
      description: "Get detailed information about a specific skill",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name" },
        },
        required: ["name"],
      },
    },
    {
      name: "wyrm_skill_delete",
      description: "Delete a skill from Wyrm registry",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name" },
        },
        required: ["name"],
      },
    },
    {
      name: "wyrm_skill_activate",
      description: "Activate a skill (mark as active)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name" },
        },
        required: ["name"],
      },
    },
    {
      name: "wyrm_skill_deactivate",
      description: "Deactivate a skill (mark as inactive)",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Skill name" },
        },
        required: ["name"],
      },
    },
    {
      name: "wyrm_skill_search",
      description: "Search for skills by name, description, or tags",
      inputSchema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          limit: { type: "number", description: "Max results (default: 20)" },
        },
        required: ["query"],
      },
    },
    {
      name: "wyrm_skill_stats",
      description: "Get statistics on registered skills",
      inputSchema: {
        type: "object",
        properties: {},
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
    // Auto-Orchestration
    {
      name: "wyrm_orchestrate_task",
      description: "Classify a task and get automatic orchestration recommendation (ensemble voting, parallel research, etc)",
      inputSchema: {
        type: "object",
        properties: {
          task: { type: "string", description: "Task description to classify and orchestrate" },
        },
        required: ["task"],
      },
    },
    {
      name: "wyrm_orchestration_config",
      description: "Get or update auto-orchestration configuration",
      inputSchema: {
        type: "object",
        properties: {
          get: { type: "boolean", description: "Get current configuration (default: true)" },
          autoOrchestrateEnabled: { type: "boolean", description: "Enable/disable auto-orchestration" },
          minConfidenceThreshold: { type: "number", description: "Min confidence for auto-apply (0-100)" },
          maxParallelAgents: { type: "number", description: "Max agents to spawn in parallel" },
          defaultHaikuBoosting: { type: "boolean", description: "Auto-boost all Haiku calls" },
          trackMetrics: { type: "boolean", description: "Track quality/cost metrics" },
        },
      },
    },
    {
      name: "wyrm_orchestration_stats",
      description: "Get auto-orchestration effectiveness statistics and task distribution",
      inputSchema: {
        type: "object",
        properties: {},
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

      // ==================== SKILLS MANAGEMENT ====================
      case "wyrm_skill_register": {
        const { name, description, skillPath, category, author, version, tags } = args as {
          name: string;
          description: string;
          skillPath: string;
          category?: string;
          author?: string;
          version?: string;
          tags?: string;
        };
        
        const skill = db.registerSkill(name, description, skillPath, category, author, version, tags);
        cache.invalidate('wyrm_skill_list');
        cache.invalidate('wyrm_skill_stats');
        
        return {
          content: [{
            type: "text",
            text: `🐉 **Skill Registered**\n\nName: ${skill.name}\nPath: ${skill.skill_path}\nCategory: ${skill.category || 'uncategorized'}\nVersion: ${skill.version || '1.0.0'}\nStatus: ${skill.is_active ? 'Active' : 'Inactive'}`
          }]
        };
      }

      case "wyrm_skill_list": {
        const { active, category, search } = args as { active?: boolean; category?: string; search?: string };
        const skills = db.listSkills(active, category, search);
        
        if (skills.length === 0) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skills**\n\nNo skills found matching your criteria.`
            }]
          };
        }
        
        let text = `🐉 **Skills Registry** (${skills.length} total)\n\n`;
        for (const skill of skills) {
          text += `### ${skill.name} ${skill.is_active ? '✅' : '❌'}\n`;
          text += `Category: ${skill.category || 'uncategorized'}\n`;
          text += `Description: ${skill.description}\n`;
          if (skill.version) text += `Version: ${skill.version}\n`;
          if (skill.author) text += `Author: ${skill.author}\n`;
          if (skill.tags) text += `Tags: ${skill.tags}\n`;
          text += `Path: \`${skill.skill_path}\`\n`;
          text += `Used: ${skill.usage_count} times`;
          if (skill.last_used) text += ` (last: ${skill.last_used})`;
          text += '\n\n';
        }
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      case "wyrm_skill_get": {
        const { name } = args as { name: string };
        const skill = db.getSkill(name);
        
        if (!skill) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Not Found**: ${name}`
            }]
          };
        }
        
        let text = `🐉 **Skill: ${skill.name}** ${skill.is_active ? '✅ Active' : '❌ Inactive'}\n\n`;
        text += `**Description:** ${skill.description}\n`;
        text += `**Path:** \`${skill.skill_path}\`\n`;
        text += `**Category:** ${skill.category || 'uncategorized'}\n`;
        if (skill.author) text += `**Author:** ${skill.author}\n`;
        if (skill.version) text += `**Version:** ${skill.version}\n`;
        if (skill.tags) text += `**Tags:** ${skill.tags}\n`;
        text += `**Usage Count:** ${skill.usage_count}\n`;
        if (skill.last_used) text += `**Last Used:** ${skill.last_used}\n`;
        text += `**Created:** ${skill.created_at}\n`;
        text += `**Updated:** ${skill.updated_at}\n`;
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      case "wyrm_skill_delete": {
        const { name } = args as { name: string };
        const success = db.deleteSkill(name);
        cache.invalidate('wyrm_skill_list');
        cache.invalidate('wyrm_skill_stats');
        
        if (success) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Deleted**: ${name}`
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Not Found**: ${name}`
            }]
          };
        }
      }

      case "wyrm_skill_activate": {
        const { name } = args as { name: string };
        const skill = db.activateSkill(name);
        cache.invalidate('wyrm_skill_list');
        cache.invalidate('wyrm_skill_stats');
        
        if (skill) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Activated**: ${name}`
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Not Found**: ${name}`
            }]
          };
        }
      }

      case "wyrm_skill_deactivate": {
        const { name } = args as { name: string };
        const skill = db.deactivateSkill(name);
        cache.invalidate('wyrm_skill_list');
        cache.invalidate('wyrm_skill_stats');
        
        if (skill) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Deactivated**: ${name}`
            }]
          };
        } else {
          return {
            content: [{
              type: "text",
              text: `🐉 **Skill Not Found**: ${name}`
            }]
          };
        }
      }

      case "wyrm_skill_search": {
        const { query, limit } = args as { query: string; limit?: number };
        const skills = db.searchSkills(query, limit || 20);
        
        if (skills.length === 0) {
          return {
            content: [{
              type: "text",
              text: `🐉 **Search Skills**: No results found for "${query}"`
            }]
          };
        }
        
        let text = `🐉 **Skill Search Results for "${query}"** (${skills.length} found)\n\n`;
        for (const skill of skills) {
          text += `- **${skill.name}** (${skill.category || 'uncategorized'}) ${skill.is_active ? '✅' : '❌'}\n`;
          text += `  ${skill.description}\n\n`;
        }
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      case "wyrm_skill_stats": {
        const stats = db.getSkillStats();
        
        let text = `🐉 **Skill Statistics**\n\n`;
        text += `**Total Skills:** ${stats.total}\n`;
        text += `**Active Skills:** ${stats.active}\n`;
        text += `**Inactive Skills:** ${stats.total - stats.active}\n\n`;
        
        if (Object.keys(stats.byCategory).length > 0) {
          text += `**By Category:**\n`;
          for (const [category, count] of Object.entries(stats.byCategory)) {
            text += `- ${category}: ${count}\n`;
          }
        }
        
        const response = cachedResponse(text);
        if (cacheKey) cache.set(cacheKey, response, 30000);
        return response;
      }

      // ==================== SEARCH ====================
      case "wyrm_search": {
        const { query, type, projectPath } = args as {
          query: string;
          type?: 'all' | 'sessions' | 'quests' | 'data' | 'skills';
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
            text += '\n';
          }
        }
        
        if (searchType === 'all' || searchType === 'skills') {
          const skills = db.searchSkills(query, 10);
          if (skills.length > 0) {
            text += `## Skills (${skills.length})\n`;
            for (const s of skills) {
              text += `- **${s.name}** (${s.category || 'uncategorized'}) ${s.is_active ? '\u2705' : '\u274c'}\n`;
              text += `  ${s.description}\n`;
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

      // ==================== AUTO-ORCHESTRATION ====================
      case "wyrm_orchestrate_task": {
        const { task } = args as { task: string };
        
        const plan = await orchestrator.processTask(task);
        
        let text = `🐉 **Orchestration Plan**\n\n`;
        text += `## Task Classification\n`;
        text += `- **Type:** ${plan.taskType}\n`;
        text += `- **Confidence:** ${plan.confidence}%\n`;
        text += `- **Recommended Approach:** ${plan.approach}\n\n`;
        
        if (plan.appliedPatterns.length > 0) {
          text += `## Patterns Applied\n`;
          for (const pattern of plan.appliedPatterns) {
            text += `- ✓ ${pattern}\n`;
          }
          text += '\n';
        }
        
        text += `## Expected Outcomes\n`;
        text += `- **Quality Boost:** +${plan.quality - 60}% (estimated)\n`;
        text += `- **Cost Savings:** ${plan.costSavings}% vs Opus\n`;
        text += `- **Parallel Execution:** ~${plan.parallelExecutionTime}ms for full pipeline\n\n`;
        
        text += `## Token Efficiency\n`;
        text += `- **Boosting Overhead:** ~${plan.metrics.tokensBoosting} tokens\n`;
        text += `- **Ensemble Voting:** ~${plan.metrics.tokensEnsemble} tokens\n`;
        text += `- **Verification:** ~${plan.metrics.tokensVerification} tokens\n`;
        text += `- **Total Estimated:** ~${plan.metrics.tokensBoosting + plan.metrics.tokensEnsemble + plan.metrics.tokensVerification} tokens\n`;
        
        return { content: [{ type: "text", text }] };
      }

      case "wyrm_orchestration_config": {
        const { 
          get = true,
          autoOrchestrateEnabled,
          minConfidenceThreshold,
          maxParallelAgents,
          defaultHaikuBoosting,
          trackMetrics,
        } = args as Partial<OrchestrationConfig> & { get?: boolean };
        
        // Update config if any properties provided
        if (!get && (autoOrchestrateEnabled !== undefined || minConfidenceThreshold !== undefined || 
                     maxParallelAgents !== undefined || defaultHaikuBoosting !== undefined || 
                     trackMetrics !== undefined)) {
          const updates: Partial<OrchestrationConfig> = {};
          if (autoOrchestrateEnabled !== undefined) updates.autoOrchestrateEnabled = autoOrchestrateEnabled;
          if (minConfidenceThreshold !== undefined) updates.minConfidenceThreshold = minConfidenceThreshold;
          if (maxParallelAgents !== undefined) updates.maxParallelAgents = maxParallelAgents;
          if (defaultHaikuBoosting !== undefined) updates.defaultHaikuBoosting = defaultHaikuBoosting;
          if (trackMetrics !== undefined) updates.trackMetrics = trackMetrics;
          
          orchestrator.updateConfig(updates);
          
          return { content: [{ type: "text", text: `🐉 Configuration updated:\n${JSON.stringify(updates, null, 2)}` }] };
        }
        
        // Get current config
        const config = getDefaultConfig();
        let text = `🐉 **Auto-Orchestration Configuration**\n\n`;
        text += `- **Auto-Orchestrate Enabled:** ${config.autoOrchestrateEnabled ? '✓ Yes' : '✗ No'}\n`;
        text += `- **Min Confidence Threshold:** ${config.minConfidenceThreshold}%\n`;
        text += `- **Max Parallel Agents:** ${config.maxParallelAgents}\n`;
        text += `- **Default Haiku Boosting:** ${config.defaultHaikuBoosting ? '✓ Yes' : '✗ No'}\n`;
        text += `- **Track Metrics:** ${config.trackMetrics ? '✓ Yes' : '✗ No'}\n`;
        text += `- **Thinking Budget:** ${config.thinkingBudget} tokens max\n`;
        
        return cachedResponse(text);
      }

      case "wyrm_orchestration_stats": {
        const stats = orchestrator.getStats();
        
        let text = `🐉 **Auto-Orchestration Statistics**\n\n`;
        text += `## Overall\n`;
        text += `- **Tasks Processed:** ${stats.tasksProcessed}\n`;
        text += `- **Average Quality Boost:** +${stats.estimatedQualityBoost}%\n`;
        text += `- **Average Cost Savings:** ${stats.estimatedCostSavings}% vs Opus\n`;
        text += `- **Average Complexity:** ${stats.averageComplexity}\n\n`;
        
        text += `## Task Distribution\n`;
        const total = stats.tasksProcessed || 1;
        for (const [type, count] of Object.entries(stats.distribution)) {
          const pct = Math.round((count / total) * 100);
          text += `- **${type}:** ${count} (${pct}%)\n`;
        }
        
        return cachedResponse(text);
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
