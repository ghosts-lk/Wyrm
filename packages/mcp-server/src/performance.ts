/**
 * 🐉 Wyrm Performance Layer
 * Caching, batching, and response optimization for AI consumption
 */

// In-memory cache with TTL
class MemCache {
  private cache = new Map<string, { data: unknown; expires: number }>();
  private defaultTTL: number;

  constructor(ttlSeconds = 30) {
    this.defaultTTL = ttlSeconds * 1000;
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      return undefined;
    }
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs?: number): void {
    this.cache.set(key, {
      data,
      expires: Date.now() + (ttlMs ?? this.defaultTTL)
    });
  }

  invalidate(pattern?: string): void {
    if (!pattern) {
      this.cache.clear();
      return;
    }
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) this.cache.delete(key);
    }
  }

  stats(): { size: number; keys: string[] } {
    return { size: this.cache.size, keys: [...this.cache.keys()] };
  }
}

// Singleton cache
export const cache = new MemCache(30);

// Compact response formats - reduce token usage
export function compactProject(p: {
  id: number;
  name: string;
  path: string;
  stack?: string | null;
}): { i: number; n: string; p: string; s?: string } {
  return { i: p.id, n: p.name, p: p.path, ...(p.stack && { s: p.stack }) };
}

export function compactQuest(q: {
  id: number;
  title: string;
  priority: string;
  status: string;
}): { i: number; t: string; p: string; s: string } {
  return { i: q.id, t: q.title, p: q.priority[0], s: q.status[0] };
}

export function compactSession(s: {
  id: number;
  date: string;
  summary?: string;
  notes?: string;
}): { i: number; d: string; s?: string } {
  const summary = s.summary || s.notes?.slice(0, 100);
  return { i: s.id, d: s.date.slice(0, 10), ...(summary && { s: summary }) };
}

// Batch request handler
export interface BatchRequest {
  op: string;
  args?: Record<string, unknown>;
}

export interface BatchResponse {
  results: Array<{ ok: boolean; data?: unknown; error?: string }>;
  time: number;
}

// Token estimation - helps AI manage context
export function estimateTokens(obj: unknown): number {
  const str = typeof obj === 'string' ? obj : JSON.stringify(obj);
  return Math.ceil(str.length / 4);
}

// Truncate to token limit
export function truncateToTokens(text: string, maxTokens: number): string {
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars - 3) + '...';
}

// Response size guard
export function guardSize<T>(data: T, maxTokens = 4000): T | { truncated: true; preview: string; tokens: number } {
  const tokens = estimateTokens(data);
  if (tokens <= maxTokens) return data;
  
  const preview = truncateToTokens(JSON.stringify(data), 500);
  return { truncated: true, preview, tokens };
}

// Diff helper - only return what changed
export function diffObjects(prev: Record<string, unknown>, curr: Record<string, unknown>): Record<string, unknown> {
  const diff: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(curr)) {
    if (JSON.stringify(prev[k]) !== JSON.stringify(v)) {
      diff[k] = v;
    }
  }
  return diff;
}

// Priority queue for operations
export class OpQueue {
  private queue: Array<{ priority: number; op: () => Promise<unknown> }> = [];
  private running = false;

  add(priority: number, op: () => Promise<unknown>): void {
    this.queue.push({ priority, op });
    this.queue.sort((a, b) => b.priority - a.priority);
    this.process();
  }

  private async process(): Promise<void> {
    if (this.running) return;
    this.running = true;
    
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      if (item) await item.op().catch(() => {});
    }
    
    this.running = false;
  }
}

// Debounce writes
export function debounce<T extends (...args: unknown[]) => unknown>(
  fn: T,
  ms: number
): (...args: Parameters<T>) => void {
  let timer: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// Measure execution time
export function timed<T>(fn: () => T): { result: T; ms: number } {
  const start = performance.now();
  const result = fn();
  return { result, ms: Math.round(performance.now() - start) };
}

export async function timedAsync<T>(fn: () => Promise<T>): Promise<{ result: T; ms: number }> {
  const start = performance.now();
  const result = await fn();
  return { result, ms: Math.round(performance.now() - start) };
}
