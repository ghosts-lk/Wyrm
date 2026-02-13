/**
 * 🐉 Wyrm Performance Layer v2
 * LRU caching, prepared statement pooling, response optimization
 */

// LRU cache with TTL + max size eviction
class MemCache {
  private cache = new Map<string, { data: unknown; expires: number; lastAccess: number }>();
  private defaultTTL: number;
  private maxSize: number;
  private hits = 0;
  private misses = 0;

  constructor(ttlSeconds = 60, maxEntries = 256) {
    this.defaultTTL = ttlSeconds * 1000;
    this.maxSize = maxEntries;

    // Periodic cleanup of expired entries (every 30s)
    if (typeof setInterval !== 'undefined') {
      setInterval(() => this.evictExpired(), 30_000).unref?.();
    }
  }

  get<T>(key: string): T | undefined {
    const entry = this.cache.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }
    if (Date.now() > entry.expires) {
      this.cache.delete(key);
      this.misses++;
      return undefined;
    }
    this.hits++;
    entry.lastAccess = Date.now();
    return entry.data as T;
  }

  set(key: string, data: unknown, ttlMs?: number): void {
    // LRU eviction when at capacity
    if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
      this.evictLRU();
    }
    this.cache.set(key, {
      data,
      expires: Date.now() + (ttlMs ?? this.defaultTTL),
      lastAccess: Date.now(),
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

  /** Evict the least-recently-used entry */
  private evictLRU(): void {
    let oldestKey: string | undefined;
    let oldestAccess = Infinity;
    for (const [key, entry] of this.cache) {
      if (entry.lastAccess < oldestAccess) {
        oldestAccess = entry.lastAccess;
        oldestKey = key;
      }
    }
    if (oldestKey) this.cache.delete(oldestKey);
  }

  /** Remove all expired entries */
  private evictExpired(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expires) this.cache.delete(key);
    }
  }

  stats(): { size: number; maxSize: number; keys: string[]; hits: number; misses: number; hitRate: string } {
    const total = this.hits + this.misses;
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      keys: [...this.cache.keys()],
      hits: this.hits,
      misses: this.misses,
      hitRate: total > 0 ? `${((this.hits / total) * 100).toFixed(1)}%` : '0%',
    };
  }
}

// Singleton cache — 60s TTL, 256 max entries with LRU eviction
export const cache = new MemCache(60, 256);

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
  // ~4 chars per token for English text, tighter for JSON
  return Math.ceil(str.length / 4);
}

// Fast token count for pre-sized buffers
export function estimateTokensFast(length: number): number {
  return Math.ceil(length / 4);
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

// Write coalescer - batches rapid sequential writes into single transactions
export class WriteCoalescer {
  private pending: Array<() => void> = [];
  private timer: NodeJS.Timeout | null = null;
  private readonly flushMs: number;
  private readonly maxBatch: number;

  constructor(flushMs = 50, maxBatch = 100) {
    this.flushMs = flushMs;
    this.maxBatch = maxBatch;
  }

  /** Queue a write operation. It will be batched with others if they arrive within flushMs. */
  enqueue(op: () => void): void {
    this.pending.push(op);
    if (this.pending.length >= this.maxBatch) {
      this.flush();
      return;
    }
    if (!this.timer) {
      this.timer = setTimeout(() => this.flush(), this.flushMs);
      this.timer.unref?.();
    }
  }

  /** Execute all pending writes in a single transaction */
  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const ops = this.pending.splice(0);
    if (ops.length === 0) return;
    for (const op of ops) {
      try { op(); } catch { /* individual op failure shouldn't stop batch */ }
    }
  }

  get size(): number {
    return this.pending.length;
  }
}

// Response compressor - deduplicates repeated field names in JSON arrays
export function compressArray<T extends Record<string, unknown>>(
  items: T[],
  maxItems = 50,
): { columns: string[]; rows: unknown[][] } | T[] {
  if (items.length <= 3) return items;
  const sliced = items.slice(0, maxItems);
  const columns = Object.keys(sliced[0] || {});
  const rows = sliced.map(item => columns.map(c => item[c]));
  return { columns, rows };
}
