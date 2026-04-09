/**
 * Wyrm Analytics — Persistent Usage Tracking & Cost Monitoring
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module analytics
 * @version 3.2.0
 */

import Database from 'better-sqlite3';

// ==================== TYPES ====================

export interface UsageEvent {
  tool: string;
  tokens_in: number;
  tokens_out: number;
  cached: boolean;
  ms: number;
  success?: boolean;
  error?: string;
  timestamp: string;
}

export interface AnalyticsDashboard {
  period: { start: string; end: string };
  summary: {
    total_calls: number;
    unique_tools: number;
    total_tokens_in: number;
    total_tokens_out: number;
    cache_hit_rate: number;
    avg_response_ms: number;
    error_rate: number;
    estimated_cost_usd: number;
  };
  top_tools: Array<{ tool: string; calls: number; tokens: number }>;
  daily: Array<{ date: string; calls: number; tokens: number; errors: number }>;
}

export interface ToolAnalytics {
  tool: string;
  total_calls: number;
  avg_tokens_in: number;
  avg_tokens_out: number;
  avg_response_ms: number;
  cache_hit_rate: number;
  error_rate: number;
  daily: Array<{ date: string; calls: number }>;
}

export interface CostReport {
  period: string;
  tools: Array<{ tool: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number }>;
  total_cost_usd: number;
  projected_monthly_usd: number;
}

// ==================== CONSTANTS ====================

/** Claude Sonnet pricing per 1M tokens */
const COST_PER_MILLION_INPUT = 3;
const COST_PER_MILLION_OUTPUT = 15;

const BUFFER_FLUSH_THRESHOLD = 50;
const FLUSH_INTERVAL_MS = 30_000;
const DEFAULT_RETAIN_DAYS = 90;

// ==================== ANALYTICS CLASS ====================

export class WyrmAnalytics {
  private db: Database.Database;
  private insertStmt: Database.Statement;
  private batchBuffer: UsageEvent[];
  private flushInterval: NodeJS.Timeout;

  constructor(db: Database.Database) {
    this.db = db;
    this.batchBuffer = [];

    this.initTables();

    this.insertStmt = this.db.prepare(`
      INSERT INTO usage_events (tool_name, tokens_in, tokens_out, cached, response_ms, success, error_message, timestamp)
      VALUES (@tool_name, @tokens_in, @tokens_out, @cached, @response_ms, @success, @error_message, @timestamp)
    `);

    this.flushInterval = setInterval(() => {
      this.flush();
    }, FLUSH_INTERVAL_MS);

    // Don't let the timer keep the process alive
    if (this.flushInterval.unref) {
      this.flushInterval.unref();
    }
  }

  // ==================== SCHEMA ====================

  private initTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS usage_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tool_name TEXT NOT NULL,
        tokens_in INTEGER DEFAULT 0,
        tokens_out INTEGER DEFAULT 0,
        cached INTEGER DEFAULT 0,
        response_ms INTEGER DEFAULT 0,
        success INTEGER DEFAULT 1,
        error_message TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cost_tracking (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        period TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        call_count INTEGER DEFAULT 0,
        total_tokens_in INTEGER DEFAULT 0,
        total_tokens_out INTEGER DEFAULT 0,
        cached_count INTEGER DEFAULT 0,
        avg_response_ms REAL DEFAULT 0,
        error_count INTEGER DEFAULT 0,
        estimated_cost_usd REAL DEFAULT 0,
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE(period, tool_name)
      );

      CREATE INDEX IF NOT EXISTS idx_usage_events_tool ON usage_events(tool_name);
      CREATE INDEX IF NOT EXISTS idx_usage_events_ts ON usage_events(timestamp);
      CREATE INDEX IF NOT EXISTS idx_cost_tracking_period ON cost_tracking(period);
    `);
  }

  // ==================== RECORDING ====================

  /** Record a single tool usage event */
  record(event: UsageEvent): void {
    this.batchBuffer.push(event);
    if (this.batchBuffer.length >= BUFFER_FLUSH_THRESHOLD) {
      this.flush();
    }
  }

  /** Flush buffered events to disk */
  flush(): void {
    if (this.batchBuffer.length === 0) return;

    const events = this.batchBuffer.splice(0);

    const insertMany = this.db.transaction((batch: UsageEvent[]) => {
      for (const event of batch) {
        this.insertStmt.run({
          tool_name: event.tool,
          tokens_in: event.tokens_in,
          tokens_out: event.tokens_out,
          cached: event.cached ? 1 : 0,
          response_ms: event.ms,
          success: event.success !== false ? 1 : 0,
          error_message: event.error ?? null,
          timestamp: event.timestamp,
        });
      }
    });

    insertMany(events);
    this.updateCostTracking(events);
  }

  /** Update cost_tracking aggregates from a batch of events */
  private updateCostTracking(events: UsageEvent[]): void {
    const groups = new Map<string, {
      tool: string;
      period: string;
      calls: number;
      tokens_in: number;
      tokens_out: number;
      cached: number;
      total_ms: number;
      errors: number;
    }>();

    for (const event of events) {
      const period = event.timestamp.slice(0, 7); // YYYY-MM
      const key = `${period}:${event.tool}`;

      let group = groups.get(key);
      if (!group) {
        group = { tool: event.tool, period, calls: 0, tokens_in: 0, tokens_out: 0, cached: 0, total_ms: 0, errors: 0 };
        groups.set(key, group);
      }

      group.calls++;
      group.tokens_in += event.tokens_in;
      group.tokens_out += event.tokens_out;
      if (event.cached) group.cached++;
      group.total_ms += event.ms;
      if (event.success === false) group.errors++;
    }

    const upsertStmt = this.db.prepare(`
      INSERT INTO cost_tracking (period, tool_name, call_count, total_tokens_in, total_tokens_out, cached_count, avg_response_ms, error_count, estimated_cost_usd, updated_at)
      VALUES (@period, @tool_name, @call_count, @total_tokens_in, @total_tokens_out, @cached_count, @avg_response_ms, @error_count, @estimated_cost_usd, datetime('now'))
      ON CONFLICT(period, tool_name) DO UPDATE SET
        call_count = call_count + @call_count,
        total_tokens_in = total_tokens_in + @total_tokens_in,
        total_tokens_out = total_tokens_out + @total_tokens_out,
        cached_count = cached_count + @cached_count,
        avg_response_ms = (avg_response_ms * call_count + @avg_response_ms * @call_count) / (call_count + @call_count),
        error_count = error_count + @error_count,
        estimated_cost_usd = estimated_cost_usd + @estimated_cost_usd,
        updated_at = datetime('now')
    `);

    const upsertMany = this.db.transaction((entries: typeof groups) => {
      for (const group of entries.values()) {
        const cost = this.estimateCost(group.tokens_in, group.tokens_out);
        upsertStmt.run({
          period: group.period,
          tool_name: group.tool,
          call_count: group.calls,
          total_tokens_in: group.tokens_in,
          total_tokens_out: group.tokens_out,
          cached_count: group.cached,
          avg_response_ms: group.calls > 0 ? group.total_ms / group.calls : 0,
          error_count: group.errors,
          estimated_cost_usd: cost,
        });
      }
    });

    upsertMany(groups);
  }

  // ==================== QUERIES ====================

  /** Get dashboard summary for a time period */
  dashboard(days: number = 30): AnalyticsDashboard {
    // Ensure buffered data is included
    this.flush();

    const start = new Date();
    start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);
    const endStr = new Date().toISOString().slice(0, 10);

    const summary = this.db.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        COUNT(DISTINCT tool_name) AS unique_tools,
        COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
        COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(SUM(cached) * 100.0 / COUNT(*), 2)
          ELSE 0
        END AS cache_hit_rate,
        COALESCE(ROUND(AVG(response_ms), 2), 0) AS avg_response_ms,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)
          ELSE 0
        END AS error_rate
      FROM usage_events
      WHERE timestamp >= @start
    `).get({ start: startStr }) as {
      total_calls: number;
      unique_tools: number;
      total_tokens_in: number;
      total_tokens_out: number;
      cache_hit_rate: number;
      avg_response_ms: number;
      error_rate: number;
    };

    const top_tools = this.db.prepare(`
      SELECT
        tool_name AS tool,
        COUNT(*) AS calls,
        COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens
      FROM usage_events
      WHERE timestamp >= @start
      GROUP BY tool_name
      ORDER BY calls DESC
      LIMIT 10
    `).all({ start: startStr }) as Array<{ tool: string; calls: number; tokens: number }>;

    const daily = this.db.prepare(`
      SELECT
        DATE(timestamp) AS date,
        COUNT(*) AS calls,
        COALESCE(SUM(tokens_in + tokens_out), 0) AS tokens,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS errors
      FROM usage_events
      WHERE timestamp >= @start
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all({ start: startStr }) as Array<{ date: string; calls: number; tokens: number; errors: number }>;

    const estimated_cost_usd = this.estimateCost(summary.total_tokens_in, summary.total_tokens_out);

    return {
      period: { start: startStr, end: endStr },
      summary: {
        total_calls: summary.total_calls,
        unique_tools: summary.unique_tools,
        total_tokens_in: summary.total_tokens_in,
        total_tokens_out: summary.total_tokens_out,
        cache_hit_rate: summary.cache_hit_rate,
        avg_response_ms: summary.avg_response_ms,
        error_rate: summary.error_rate,
        estimated_cost_usd,
      },
      top_tools,
      daily,
    };
  }

  /** Get per-tool breakdown */
  toolBreakdown(toolName: string, days: number = 30): ToolAnalytics {
    this.flush();

    const start = new Date();
    start.setDate(start.getDate() - days);
    const startStr = start.toISOString().slice(0, 10);

    const stats = this.db.prepare(`
      SELECT
        COUNT(*) AS total_calls,
        COALESCE(ROUND(AVG(tokens_in), 2), 0) AS avg_tokens_in,
        COALESCE(ROUND(AVG(tokens_out), 2), 0) AS avg_tokens_out,
        COALESCE(ROUND(AVG(response_ms), 2), 0) AS avg_response_ms,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(SUM(cached) * 100.0 / COUNT(*), 2)
          ELSE 0
        END AS cache_hit_rate,
        CASE WHEN COUNT(*) > 0
          THEN ROUND(SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2)
          ELSE 0
        END AS error_rate
      FROM usage_events
      WHERE tool_name = @tool AND timestamp >= @start
    `).get({ tool: toolName, start: startStr }) as {
      total_calls: number;
      avg_tokens_in: number;
      avg_tokens_out: number;
      avg_response_ms: number;
      cache_hit_rate: number;
      error_rate: number;
    };

    const daily = this.db.prepare(`
      SELECT
        DATE(timestamp) AS date,
        COUNT(*) AS calls
      FROM usage_events
      WHERE tool_name = @tool AND timestamp >= @start
      GROUP BY DATE(timestamp)
      ORDER BY date ASC
    `).all({ tool: toolName, start: startStr }) as Array<{ date: string; calls: number }>;

    return {
      tool: toolName,
      total_calls: stats.total_calls,
      avg_tokens_in: stats.avg_tokens_in,
      avg_tokens_out: stats.avg_tokens_out,
      avg_response_ms: stats.avg_response_ms,
      cache_hit_rate: stats.cache_hit_rate,
      error_rate: stats.error_rate,
      daily,
    };
  }

  /** Get cost estimate for a period */
  costReport(period?: string): CostReport {
    this.flush();

    const targetPeriod = period ?? new Date().toISOString().slice(0, 7);

    const tools = this.db.prepare(`
      SELECT
        tool_name AS tool,
        call_count AS calls,
        total_tokens_in AS tokens_in,
        total_tokens_out AS tokens_out,
        estimated_cost_usd AS cost_usd
      FROM cost_tracking
      WHERE period = @period
      ORDER BY estimated_cost_usd DESC
    `).all({ period: targetPeriod }) as Array<{ tool: string; calls: number; tokens_in: number; tokens_out: number; cost_usd: number }>;

    const total_cost_usd = tools.reduce((sum, t) => sum + t.cost_usd, 0);

    // Project monthly cost based on days elapsed in the period
    const now = new Date();
    const periodYear = parseInt(targetPeriod.slice(0, 4), 10);
    const periodMonth = parseInt(targetPeriod.slice(5, 7), 10) - 1;
    const periodStart = new Date(periodYear, periodMonth, 1);
    const periodEnd = new Date(periodYear, periodMonth + 1, 0); // last day of month
    const totalDaysInMonth = periodEnd.getDate();

    const elapsed = Math.max(1, Math.ceil((now.getTime() - periodStart.getTime()) / (1000 * 60 * 60 * 24)));
    const daysToProject = Math.min(elapsed, totalDaysInMonth);
    const projected_monthly_usd = totalDaysInMonth > 0
      ? Math.round(((total_cost_usd / daysToProject) * totalDaysInMonth) * 100) / 100
      : total_cost_usd;

    return {
      period: targetPeriod,
      tools,
      total_cost_usd: Math.round(total_cost_usd * 100) / 100,
      projected_monthly_usd,
    };
  }

  /** Clean up old events (retention policy) */
  cleanup(retainDays: number = DEFAULT_RETAIN_DAYS): { deleted: number } {
    this.flush();

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retainDays);
    const cutoffStr = cutoff.toISOString().slice(0, 10);

    // Aggregate old events into cost_tracking before deleting
    const oldEvents = this.db.prepare(`
      SELECT
        STRFTIME('%Y-%m', timestamp) AS period,
        tool_name,
        COUNT(*) AS call_count,
        COALESCE(SUM(tokens_in), 0) AS total_tokens_in,
        COALESCE(SUM(tokens_out), 0) AS total_tokens_out,
        SUM(cached) AS cached_count,
        COALESCE(AVG(response_ms), 0) AS avg_response_ms,
        SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) AS error_count
      FROM usage_events
      WHERE timestamp < @cutoff
      GROUP BY STRFTIME('%Y-%m', timestamp), tool_name
    `).all({ cutoff: cutoffStr }) as Array<{
      period: string;
      tool_name: string;
      call_count: number;
      total_tokens_in: number;
      total_tokens_out: number;
      cached_count: number;
      avg_response_ms: number;
      error_count: number;
    }>;

    const upsertStmt = this.db.prepare(`
      INSERT INTO cost_tracking (period, tool_name, call_count, total_tokens_in, total_tokens_out, cached_count, avg_response_ms, error_count, estimated_cost_usd, updated_at)
      VALUES (@period, @tool_name, @call_count, @total_tokens_in, @total_tokens_out, @cached_count, @avg_response_ms, @error_count, @estimated_cost_usd, datetime('now'))
      ON CONFLICT(period, tool_name) DO UPDATE SET
        call_count = call_count + @call_count,
        total_tokens_in = total_tokens_in + @total_tokens_in,
        total_tokens_out = total_tokens_out + @total_tokens_out,
        cached_count = cached_count + @cached_count,
        avg_response_ms = (avg_response_ms * call_count + @avg_response_ms * @call_count) / (call_count + @call_count),
        error_count = error_count + @error_count,
        estimated_cost_usd = estimated_cost_usd + @estimated_cost_usd,
        updated_at = datetime('now')
    `);

    const cleanupTxn = this.db.transaction(() => {
      for (const row of oldEvents) {
        const cost = this.estimateCost(row.total_tokens_in, row.total_tokens_out);
        upsertStmt.run({
          period: row.period,
          tool_name: row.tool_name,
          call_count: row.call_count,
          total_tokens_in: row.total_tokens_in,
          total_tokens_out: row.total_tokens_out,
          cached_count: row.cached_count,
          avg_response_ms: row.avg_response_ms,
          error_count: row.error_count,
          estimated_cost_usd: cost,
        });
      }

      const result = this.db.prepare(`
        DELETE FROM usage_events WHERE timestamp < @cutoff
      `).run({ cutoff: cutoffStr });

      return result.changes;
    });

    const deleted = cleanupTxn();

    return { deleted };
  }

  /** Shutdown: flush remaining buffer and clear timer */
  shutdown(): void {
    clearInterval(this.flushInterval);
    this.flush();
  }

  // ==================== HELPERS ====================

  /** Estimate USD cost from token counts (Claude Sonnet rates) */
  private estimateCost(tokensIn: number, tokensOut: number): number {
    const inputCost = (tokensIn / 1_000_000) * COST_PER_MILLION_INPUT;
    const outputCost = (tokensOut / 1_000_000) * COST_PER_MILLION_OUTPUT;
    return Math.round((inputCost + outputCost) * 1_000_000) / 1_000_000;
  }
}
