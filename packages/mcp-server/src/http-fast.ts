/**
 * 🐉 Wyrm Fast API
 * Optimized for AI consumption - minimal latency, compact responses
 */

import http from 'http';
import { WyrmDB } from './database.js';
import { cache, estimateTokens, truncateToTokens, timed } from './performance.js';

const PORT = parseInt(process.env.WYRM_PORT || '3333');
const db = new WyrmDB();

// Prepared statement cache - reuse queries
const stmtCache = new Map<string, unknown>();

// Minimal JSON response
function send(res: http.ServerResponse, data: unknown, status = 200): void {
  const json = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(json),
    'X-Tokens': String(estimateTokens(data)),
    'Access-Control-Allow-Origin': '*'
  });
  res.end(json);
}

// Fast body parser - no streaming for small payloads
function body(req: http.IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    if (req.method === 'GET') {
      resolve({});
      return;
    }
    let data = '';
    req.on('data', c => data += c);
    req.on('end', () => {
      try { resolve(data ? JSON.parse(data) : {}); }
      catch { resolve({}); }
    });
  });
}

// Route table - direct function calls, no middleware
type Handler = (args: Record<string, unknown>) => unknown;
const routes: Record<string, Handler> = {

  // Quick context for AI - most used endpoint
  'GET /c': (args) => {
    const cacheKey = `ctx:${args.p || 'global'}`;
    const cached = cache.get(cacheKey);
    if (cached) return cached;

    const projectPath = args.p as string | undefined;
    let result;

    if (projectPath) {
      const project = db.getProject(projectPath);
      if (!project) return { e: 'not found' };

      const quests = db.getPendingQuests(project.id);
      const sessions = db.getRecentSessions(project.id, 3);
      
      result = {
        n: project.name,
        s: project.stack,
        q: quests.length,
        qt: quests.slice(0, 5).map(q => q.title),
        r: sessions[0]?.summary || sessions[0]?.notes?.slice(0, 200) || null
      };
    } else {
      const projects = db.getAllProjects(20);
      const quests = db.getAllPendingQuests();
      
      result = {
        p: projects.map(p => ({ n: p.name, s: p.stack, q: db.getPendingQuests(p.id).length })),
        tq: quests.length
      };
    }

    cache.set(cacheKey, result);
    return result;
  },

  // List projects - compact
  'GET /p': () => {
    const cached = cache.get('projects');
    if (cached) return cached;

    const projects = db.getAllProjects(50);
    const result = projects.map(p => ({
      i: p.id,
      n: p.name,
      p: p.path,
      s: p.stack
    }));

    cache.set('projects', result);
    return result;
  },

  // Scan for projects
  'POST /scan': (args) => {
    const dir = (args.d || args.directory || process.env.HOME + '/Git Projects') as string;
    cache.invalidate();
    const projects = db.scanForProjects(dir, true);
    return { found: projects.length };
  },

  // Get quests
  'GET /q': (args) => {
    const projectPath = args.p as string | undefined;
    
    if (projectPath) {
      const project = db.getProject(projectPath);
      if (!project) return { e: 'not found' };
      return db.getPendingQuests(project.id).map(q => ({
        i: q.id,
        t: q.title,
        p: q.priority[0]
      }));
    }

    return db.getAllPendingQuests().slice(0, 20).map(q => ({
      i: q.id,
      t: q.title,
      p: q.priority[0]
    }));
  },

  // Add quest
  'POST /q': (args) => {
    const projectPath = args.p as string;
    const project = db.getProject(projectPath);
    if (!project) return { e: 'not found' };
    
    cache.invalidate('ctx');
    const quest = db.addQuest(
      project.id,
      args.t as string,
      args.d as string | undefined,
      (args.pr as 'low' | 'medium' | 'high' | 'critical') || 'medium'
    );
    return { i: quest.id };
  },

  // Complete quest
  'POST /qc': (args) => {
    const id = args.i as number;
    cache.invalidate('ctx');
    db.updateQuest(id, 'completed');
    return { ok: 1 };
  },

  // Start/get session
  'POST /s': (args) => {
    const projectPath = args.p as string;
    let project = db.getProject(projectPath);
    
    if (!project) {
      db.scanForProjects(projectPath, false);
      project = db.getProject(projectPath);
    }
    if (!project) return { e: 'not found' };

    let session = db.getTodaySession(project.id);
    if (!session) {
      session = db.createSession(project.id, {
        objectives: args.o as string || '',
        notes: ''
      });
    }

    cache.invalidate('ctx');
    return { i: session.id, d: session.date };
  },

  // Update session
  'POST /su': (args) => {
    const id = args.i as number;
    cache.invalidate('ctx');
    db.updateSession(id, {
      notes: args.n as string,
      summary: args.s as string,
      completed: args.c as string
    });
    return { ok: 1 };
  },

  // Set context
  'POST /x': (args) => {
    const projectPath = args.p as string;
    const project = db.getProject(projectPath);
    if (!project) return { e: 'not found' };

    db.setContext(project.id, args.k as string, args.v as string);
    cache.invalidate('ctx');
    return { ok: 1 };
  },

  // Get context
  'GET /x': (args) => {
    const projectPath = args.p as string;
    const project = db.getProject(projectPath);
    if (!project) return { e: 'not found' };

    return db.getAllContext(project.id);
  },

  // Global context
  'POST /g': (args) => {
    db.setGlobalContext(args.k as string, args.v as string);
    cache.invalidate();
    return { ok: 1 };
  },

  'GET /g': () => db.getAllGlobalContext(),

  // Search
  'GET /s': (args) => {
    const q = args.q as string;
    if (!q) return { e: 'query required' };

    const results = {
      q: db.searchQuests(q).slice(0, 5).map(x => ({ i: x.id, t: x.title })),
      s: db.searchSessions(q).slice(0, 3).map(x => ({ i: x.id, d: x.date })),
      p: db.searchProjects(q).slice(0, 3).map(x => ({ n: x.name, p: x.path }))
    };

    return results;
  },

  // Data lake - insert
  'POST /d': (args) => {
    const projectPath = args.p as string;
    const project = db.getProject(projectPath);
    if (!project) return { e: 'not found' };

    const dp = db.insertData(
      project.id,
      args.c as string,
      args.k as string,
      args.v as string,
      args.m as Record<string, unknown>
    );
    return { i: dp.id };
  },

  // Data lake - query
  'GET /d': (args) => {
    const projectPath = args.p as string;
    const project = db.getProject(projectPath);
    if (!project) return { e: 'not found' };

    const limit = Math.min((args.l as number) || 20, 100);
    return db.queryData(project.id, args.c as string, limit).map(d => ({
      k: d.key,
      v: truncateToTokens(d.value, 100)
    }));
  },

  // Batch operations
  'POST /batch': (args) => {
    const ops = args.ops as Array<{ m: string; r: string; a?: Record<string, unknown> }>;
    if (!ops || !Array.isArray(ops)) return { e: 'ops required' };

    const start = performance.now();
    const results = ops.map(op => {
      const key = `${op.m} ${op.r}`;
      const handler = routes[key];
      if (!handler) return { e: 'unknown' };
      try {
        return { d: handler(op.a || {}) };
      } catch (err) {
        return { e: (err as Error).message };
      }
    });

    return { r: results, ms: Math.round(performance.now() - start) };
  },

  // Stats
  'GET /stats': () => {
    const { result, ms } = timed(() => db.getStats());
    return { ...result, ms, cache: cache.stats() };
  },

  // Health check
  'GET /health': () => ({ ok: 1, ts: Date.now() })
};

// Server
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type'
    });
    res.end();
    return;
  }

  try {
    const url = new URL(req.url || '/', `http://localhost:${PORT}`);
    const args = await body(req);
    
    // Add query params
    url.searchParams.forEach((v, k) => args[k] = v);

    const key = `${req.method} ${url.pathname}`;
    const handler = routes[key];

    if (!handler) {
      if (url.pathname === '/') {
        send(res, {
          wyrm: '2.2',
          routes: Object.keys(routes).sort(),
          tip: 'GET /c for quick context'
        });
        return;
      }
      send(res, { e: 'not found' }, 404);
      return;
    }

    const { result, ms } = timed(() => handler(args));
    res.setHeader('X-Time-Ms', String(ms));
    send(res, result);

  } catch (err) {
    send(res, { e: (err as Error).message }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`🐉 Wyrm Fast API on :${PORT}`);
});

export { server };
