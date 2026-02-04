#!/usr/bin/env node
/**
 * 🐉 Wyrm HTTP API Server
 * REST API wrapper for local LLMs (Ollama, LM Studio, llama.cpp, etc.)
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 */

import http from 'http';
import { WyrmDB } from './database.js';
import { createContextBundle } from './summarizer.js';
import { authMiddleware, getSecurityHeaders, getAuthStatus } from './http-auth.js';
import { getLogger } from './logger.js';

const PORT = parseInt(process.env.WYRM_PORT || '3333');
const MAX_BODY_SIZE = 1024 * 1024; // 1MB limit
const db = new WyrmDB();
const logger = getLogger();

interface RequestBody {
  [key: string]: unknown;
}

function parseBody(req: http.IncomingMessage): Promise<RequestBody> {
  return new Promise((resolve, reject) => {
    let body = '';
    let size = 0;
    
    req.on('data', chunk => {
      size += chunk.length;
      if (size > MAX_BODY_SIZE) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });
    
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Invalid JSON'));
      }
    });
    req.on('error', reject);
  });
}

function jsonResponse(res: http.ServerResponse, req: http.IncomingMessage, data: unknown, status = 200) {
  const headers = getSecurityHeaders(req);
  res.writeHead(status, { 
    ...headers,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify(data, null, 2));
}

function errorResponse(res: http.ServerResponse, req: http.IncomingMessage, message: string, status = 400) {
  jsonResponse(res, req, { error: message }, status);
}

// Route handlers
const routes: Record<string, (body: RequestBody) => unknown> = {
  
  // ==================== PROJECTS ====================
  
  'GET /projects': () => {
    const projects = db.getAllProjects(100);
    return { projects: projects.map(p => ({
      ...p,
      stats: db.getProjectStats(p.id)
    }))};
  },
  
  'POST /projects/scan': (body) => {
    const dir = body.directory as string || process.env.HOME + '/Git Projects';
    const recursive = body.recursive !== false;
    const projects = db.scanForProjects(dir, recursive);
    return { 
      discovered: projects.length,
      projects: projects.map(p => ({ id: p.id, name: p.name, path: p.path }))
    };
  },
  
  'GET /projects/:path': (body) => {
    const project = db.getProject(body.path as string);
    if (!project) return { error: 'Project not found' };
    
    const sessions = db.getRecentSessions(project.id, 10);
    const quests = db.getPendingQuests(project.id);
    const context = db.getAllContext(project.id);
    
    return {
      project,
      sessions,
      quests,
      context,
      stats: db.getProjectStats(project.id)
    };
  },
  
  // ==================== SESSIONS ====================
  
  'POST /sessions/start': (body) => {
    const projectPath = body.projectPath as string;
    let project = db.getProject(projectPath);
    
    if (!project) {
      // Try to scan and find it
      db.scanForProjects(projectPath, false);
      project = db.getProject(projectPath);
    }
    
    if (!project) return { error: 'Could not find or register project' };
    
    // Check for existing today session
    let session = db.getTodaySession(project.id);
    if (!session) {
      session = db.createSession(project.id, {
        objectives: body.objectives as string || '',
        notes: body.notes as string || ''
      });
    }
    
    return { session, project: { id: project.id, name: project.name } };
  },
  
  'POST /sessions/update': (body) => {
    const sessionId = body.sessionId as number;
    
    const session = db.updateSession(sessionId, {
      notes: body.notes as string,
      completed: body.completed as string,
      summary: body.summary as string
    });
    
    return { session };
  },
  
  'GET /sessions/:projectId': (body) => {
    const projectId = parseInt(body.projectId as string);
    const limit = (body.limit as number) || 10;
    return { sessions: db.getRecentSessions(projectId, limit) };
  },
  
  // ==================== QUESTS ====================
  
  'POST /quests': (body) => {
    const projectPath = body.projectPath as string;
    const project = db.getProject(projectPath);
    if (!project) return { error: 'Project not found' };
    
    const quest = db.addQuest(
      project.id,
      body.title as string,
      body.description as string | undefined,
      (body.priority as 'low' | 'medium' | 'high' | 'critical') || 'medium',
      body.tags as string | undefined
    );
    
    return { quest };
  },
  
  'POST /quests/:id/complete': (body) => {
    const id = parseInt(body.id as string);
    const quest = db.updateQuest(id, 'completed');
    return { quest };
  },
  
  'GET /quests': (body) => {
    const projectPath = body.projectPath as string | undefined;
    
    if (projectPath) {
      const project = db.getProject(projectPath);
      if (!project) return { error: 'Project not found' };
      return { quests: db.getPendingQuests(project.id) };
    }
    
    return { quests: db.getAllPendingQuests() };
  },
  
  // ==================== CONTEXT ====================
  
  'POST /context': (body) => {
    const projectPath = body.projectPath as string;
    const project = db.getProject(projectPath);
    if (!project) return { error: 'Project not found' };
    
    db.setContext(project.id, body.key as string, body.value as string);
    return { success: true };
  },
  
  'GET /context/:projectPath': (body) => {
    const project = db.getProject(body.projectPath as string);
    if (!project) return { error: 'Project not found' };
    
    const sessions = db.getRecentSessions(project.id, 10);
    const quests = db.getPendingQuests(project.id).map(q => ({ title: q.title, priority: q.priority }));
    const context = db.getAllContext(project.id);
    
    const bundle = createContextBundle(
      { name: project.name, stack: project.stack },
      context,
      sessions,
      quests
    );
    
    return { context: bundle };
  },
  
  // ==================== GLOBAL ====================
  
  'POST /global': (body) => {
    db.setGlobalContext(body.key as string, body.value as string);
    return { success: true };
  },
  
  'GET /global': () => {
    return { context: db.getAllGlobalContext() };
  },
  
  // ==================== DATA LAKE ====================
  
  'POST /data': (body) => {
    const projectPath = body.projectPath as string;
    const project = db.getProject(projectPath);
    if (!project) return { error: 'Project not found' };
    
    const dataPoint = db.insertData(
      project.id,
      body.category as string,
      body.key as string,
      body.value as string,
      body.metadata as Record<string, unknown> | undefined
    );
    
    return { data: dataPoint };
  },
  
  'POST /data/batch': (body) => {
    const items = body.items as Array<{
      projectPath: string;
      category: string;
      key: string;
      value: string;
      metadata?: Record<string, unknown>;
    }>;
    
    const data = items.map(item => {
      const project = db.getProject(item.projectPath);
      if (!project) throw new Error(`Project not found: ${item.projectPath}`);
      return {
        projectId: project.id,
        category: item.category,
        key: item.key,
        value: item.value,
        metadata: item.metadata
      };
    });
    
    const count = db.insertDataBatch(data);
    return { inserted: count };
  },
  
  'GET /data/:projectPath': (body) => {
    const project = db.getProject(body.projectPath as string);
    if (!project) return { error: 'Project not found' };
    
    const category = body.category as string | undefined;
    const limit = (body.limit as number) || 100;
    
    return { data: db.queryData(project.id, category, limit) };
  },
  
  'GET /data/categories/:projectPath': (body) => {
    const project = db.getProject(body.projectPath as string);
    if (!project) return { error: 'Project not found' };
    
    return { categories: db.getDataCategories(project.id) };
  },
  
  // ==================== SEARCH ====================
  
  'GET /search': (body) => {
    const query = body.query as string;
    if (!query) return { error: 'Query required' };
    
    return {
      sessions: db.searchSessions(query),
      quests: db.searchQuests(query),
      data: db.searchData(query),
      projects: db.searchProjects(query)
    };
  },
  
  // ==================== STATS & MAINTENANCE ====================
  
  'GET /stats': () => {
    return db.getStats();
  },
  
  'POST /maintenance': (body) => {
    const action = body.action as string;
    const results: string[] = [];
    
    if (action === 'vacuum' || action === 'all') {
      db.vacuum();
      results.push('Vacuum completed');
    }
    
    if (action === 'checkpoint' || action === 'all') {
      db.checkpoint();
      results.push('WAL checkpoint completed');
    }
    
    return { results };
  },
  
  // ==================== LLM CONTEXT ENDPOINT ====================
  // Special endpoint that returns everything an LLM needs in one call
  
  'GET /llm-context': (body) => {
    const projectPath = body.projectPath as string | undefined;
    
    if (projectPath) {
      const project = db.getProject(projectPath);
      if (!project) return { error: 'Project not found' };
      
      const sessions = db.getRecentSessions(project.id, 5);
      const quests = db.getPendingQuests(project.id);
      const context = db.getAllContext(project.id);
      
      return {
        project: { name: project.name, stack: project.stack, path: project.path },
        recentSessions: sessions.map(s => ({
          date: s.date,
          summary: s.summary || s.notes?.slice(0, 500)
        })),
        pendingQuests: quests.map(q => ({
          title: q.title,
          priority: q.priority,
          description: q.description
        })),
        context,
        systemPrompt: `You are working on ${project.name}${project.stack ? ` (${project.stack})` : ''}. ` +
          `There are ${quests.length} pending tasks. ` +
          `Recent work: ${sessions[0]?.summary || 'No recent sessions'}.`
      };
    }
    
    // Global context for all projects
    const projects = db.getAllProjects(10);
    const globalContext = db.getAllGlobalContext();
    const allQuests = db.getAllPendingQuests();
    
    return {
      projects: projects.map(p => ({
        name: p.name,
        path: p.path,
        stack: p.stack,
        stats: db.getProjectStats(p.id)
      })),
      globalContext,
      totalPendingQuests: allQuests.length,
      topQuests: allQuests.slice(0, 5).map(q => ({
        project: projects.find(p => p.id === q.project_id)?.name,
        title: q.title,
        priority: q.priority
      })),
      systemPrompt: `You have access to ${projects.length} projects with ${allQuests.length} total pending tasks.`
    };
  },
  
  // Auth status endpoint (no auth required for this one)
  'GET /auth/status': () => {
    return getAuthStatus();
  },
  
  // Health check endpoint (no auth required)
  'GET /health': () => {
    return { status: 'ok', timestamp: Date.now(), version: '3.0.0' };
  }
};

const server = http.createServer(async (req, res) => {
  // Apply authentication middleware (handles CORS preflight, rate limiting, auth)
  const authResult = authMiddleware(req, res);
  if (authResult.error) {
    return; // Response already sent by middleware
  }
  
  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const body = await parseBody(req);
    
    // Add URL params to body
    url.searchParams.forEach((value, key) => {
      body[key] = value;
    });
    
    // Extract path parameters
    const pathParts = url.pathname.split('/').filter(Boolean);
    
    // Try exact route match first
    let routeKey = `${req.method} ${url.pathname}`;
    let handler = routes[routeKey];
    
    // Try parameterized routes
    if (!handler) {
      for (const [pattern, h] of Object.entries(routes)) {
        const [method, path] = pattern.split(' ');
        if (method !== req.method) continue;
        
        const patternParts = path.split('/').filter(Boolean);
        if (patternParts.length !== pathParts.length) continue;
        
        let match = true;
        for (let i = 0; i < patternParts.length; i++) {
          if (patternParts[i].startsWith(':')) {
            body[patternParts[i].slice(1)] = pathParts[i];
          } else if (patternParts[i] !== pathParts[i]) {
            match = false;
            break;
          }
        }
        
        if (match) {
          handler = h;
          break;
        }
      }
    }
    
    if (!handler) {
      if (url.pathname === '/' || url.pathname === '/help') {
        jsonResponse(res, req, {
          name: '🐉 Wyrm HTTP API',
          version: '3.0.0',
          description: 'REST API for local LLM integration',
          authentication: 'Bearer token required (see ~/.wyrm/http-config.json)',
          endpoints: Object.keys(routes).sort(),
          specialEndpoints: {
            '/llm-context': 'Get everything an LLM needs in one call',
            '/llm-context?projectPath=...': 'Get project-specific context',
            '/auth/status': 'Check authentication configuration'
          }
        });
        return;
      }
      
      errorResponse(res, req, 'Not found', 404);
      return;
    }
    
    const result = handler(body);
    jsonResponse(res, req, result);
    
  } catch (err) {
    logger.error('HTTP request failed', { 
      path: req.url, 
      error: (err as Error).message 
    });
    errorResponse(res, req, (err as Error).message, 500);
  }
});

server.listen(PORT, () => {
  logger.info('Wyrm HTTP API started', { port: PORT });
  console.log(`🐉 Wyrm HTTP API running on http://localhost:${PORT}`);
  console.log(`   Documentation: http://localhost:${PORT}/help`);
  console.log(`   LLM Context:   http://localhost:${PORT}/llm-context`);
  console.log(`   Auth Required: ${getAuthStatus().requireAuth ? 'Yes' : 'No (dev mode)'}`);
});

export { server };
