/**
 * Analytics module tests — WyrmAnalytics: recording, dashboard, tool breakdown, cost report, cleanup
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync } from 'fs';
import Database from 'better-sqlite3';
import { WyrmAnalytics, type UsageEvent, type AnalyticsDashboard, type ToolAnalytics, type CostReport } from '../src/analytics.js';

const TEST_DB_DIR = join(process.cwd(), '.test-dbs-analytics');
let dbCounter = 0;

function createTestAnalytics(): { analytics: WyrmAnalytics; db: Database.Database } {
  if (!existsSync(TEST_DB_DIR)) {
    mkdirSync(TEST_DB_DIR, { recursive: true });
  }
  const db = new Database(join(TEST_DB_DIR, `analytics-${process.pid}-${++dbCounter}.db`));
  const analytics = new WyrmAnalytics(db);
  return { analytics, db };
}

afterAll(() => {
  try {
    if (existsSync(TEST_DB_DIR)) {
      rmSync(TEST_DB_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

function makeEvent(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    tool: overrides.tool ?? 'wyrm_search',
    tokens_in: overrides.tokens_in ?? 100,
    tokens_out: overrides.tokens_out ?? 200,
    cached: overrides.cached ?? false,
    ms: overrides.ms ?? 50,
    success: overrides.success ?? true,
    error: overrides.error,
    timestamp: overrides.timestamp ?? new Date().toISOString(),
  };
}

// ==================== Recording ====================

describe('WyrmAnalytics — Recording', () => {
  let analytics: WyrmAnalytics;
  let db: Database.Database;

  beforeEach(() => {
    ({ analytics, db } = createTestAnalytics());
  });
  afterEach(() => {
    analytics.shutdown();
    db.close();
  });

  it('records a single event and flushes', () => {
    analytics.record(makeEvent());
    analytics.flush();

    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events').get() as { c: number }).c;
    expect(count).toBe(1);
  });

  it('records multiple events', () => {
    for (let i = 0; i < 10; i++) {
      analytics.record(makeEvent({ tool: `tool_${i}` }));
    }
    analytics.flush();

    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events').get() as { c: number }).c;
    expect(count).toBe(10);
  });

  it('auto-flushes at buffer threshold (50)', () => {
    for (let i = 0; i < 55; i++) {
      analytics.record(makeEvent());
    }
    // At least 50 should have been flushed automatically
    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events').get() as { c: number }).c;
    expect(count).toBeGreaterThanOrEqual(50);
  });

  it('records error events', () => {
    analytics.record(makeEvent({ success: false, error: 'Connection refused' }));
    analytics.flush();

    const row = db.prepare('SELECT * FROM usage_events WHERE success = 0').get() as any;
    expect(row).toBeDefined();
    expect(row.error_message).toBe('Connection refused');
  });

  it('records cached events', () => {
    analytics.record(makeEvent({ cached: true }));
    analytics.flush();

    const row = db.prepare('SELECT * FROM usage_events WHERE cached = 1').get() as any;
    expect(row).toBeDefined();
  });
});

// ==================== Dashboard ====================

describe('WyrmAnalytics — Dashboard', () => {
  let analytics: WyrmAnalytics;
  let db: Database.Database;

  beforeEach(() => {
    ({ analytics, db } = createTestAnalytics());
  });
  afterEach(() => {
    analytics.shutdown();
    db.close();
  });

  it('returns dashboard with summary for recorded events', () => {
    analytics.record(makeEvent({ tokens_in: 500, tokens_out: 1000, ms: 100 }));
    analytics.record(makeEvent({ tokens_in: 300, tokens_out: 600, cached: true, ms: 10 }));

    const dashboard = analytics.dashboard(30);
    expect(dashboard).toBeDefined();
    expect(dashboard.summary.total_calls).toBe(2);
    expect(dashboard.summary.unique_tools).toBe(1);
    expect(dashboard.summary.total_tokens_in).toBe(800);
    expect(dashboard.summary.total_tokens_out).toBe(1600);
    expect(dashboard.summary.cache_hit_rate).toBe(50);
    expect(dashboard.summary.error_rate).toBe(0);
    expect(dashboard.period.start).toBeDefined();
    expect(dashboard.period.end).toBeDefined();
  });

  it('returns top tools', () => {
    for (let i = 0; i < 5; i++) analytics.record(makeEvent({ tool: 'wyrm_search' }));
    for (let i = 0; i < 3; i++) analytics.record(makeEvent({ tool: 'wyrm_stats' }));
    analytics.record(makeEvent({ tool: 'wyrm_list_projects' }));

    const dashboard = analytics.dashboard(30);
    expect(dashboard.top_tools.length).toBeGreaterThanOrEqual(1);
    expect(dashboard.top_tools[0].tool).toBe('wyrm_search');
    expect(dashboard.top_tools[0].calls).toBe(5);
  });

  it('returns empty dashboard for no events', () => {
    const dashboard = analytics.dashboard(30);
    expect(dashboard.summary.total_calls).toBe(0);
    expect(dashboard.top_tools).toHaveLength(0);
    expect(dashboard.daily).toHaveLength(0);
  });

  it('includes estimated cost in summary', () => {
    analytics.record(makeEvent({ tokens_in: 1000000, tokens_out: 500000 }));
    const dashboard = analytics.dashboard(30);
    expect(dashboard.summary.estimated_cost_usd).toBeGreaterThan(0);
  });
});

// ==================== Tool Breakdown ====================

describe('WyrmAnalytics — Tool Breakdown', () => {
  let analytics: WyrmAnalytics;
  let db: Database.Database;

  beforeEach(() => {
    ({ analytics, db } = createTestAnalytics());
  });
  afterEach(() => {
    analytics.shutdown();
    db.close();
  });

  it('returns per-tool analytics', () => {
    for (let i = 0; i < 5; i++) {
      analytics.record(makeEvent({ tool: 'wyrm_search', tokens_in: 100, tokens_out: 200, ms: 50 + i * 10 }));
    }

    const breakdown = analytics.toolBreakdown('wyrm_search', 30);
    expect(breakdown.tool).toBe('wyrm_search');
    expect(breakdown.total_calls).toBe(5);
    expect(breakdown.avg_tokens_in).toBe(100);
    expect(breakdown.avg_tokens_out).toBe(200);
    expect(breakdown.avg_response_ms).toBeGreaterThan(0);
  });

  it('returns zero stats for unknown tool', () => {
    const breakdown = analytics.toolBreakdown('nonexistent_tool', 30);
    expect(breakdown.total_calls).toBe(0);
  });
});

// ==================== Cost Report ====================

describe('WyrmAnalytics — Cost Report', () => {
  let analytics: WyrmAnalytics;
  let db: Database.Database;

  beforeEach(() => {
    ({ analytics, db } = createTestAnalytics());
  });
  afterEach(() => {
    analytics.shutdown();
    db.close();
  });

  it('returns cost report for current period', () => {
    analytics.record(makeEvent({ tokens_in: 1000, tokens_out: 2000 }));
    analytics.flush();

    const report = analytics.costReport();
    expect(report).toBeDefined();
    expect(report.period).toMatch(/^\d{4}-\d{2}$/);
    expect(report.total_cost_usd).toBeGreaterThanOrEqual(0);
    expect(report.projected_monthly_usd).toBeGreaterThanOrEqual(0);
  });

  it('returns empty cost report for period with no data', () => {
    const report = analytics.costReport('2020-01');
    expect(report.tools).toHaveLength(0);
    expect(report.total_cost_usd).toBe(0);
  });
});

// ==================== Cleanup ====================

describe('WyrmAnalytics — Cleanup', () => {
  let analytics: WyrmAnalytics;
  let db: Database.Database;

  beforeEach(() => {
    ({ analytics, db } = createTestAnalytics());
  });
  afterEach(() => {
    analytics.shutdown();
    db.close();
  });

  it('deletes old events based on retention days', () => {
    // Insert an old event (200 days ago)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 200);
    analytics.record(makeEvent({ timestamp: oldDate.toISOString() }));
    analytics.flush();

    const result = analytics.cleanup(90);
    expect(result.deleted).toBe(1);
  });

  it('keeps recent events during cleanup', () => {
    analytics.record(makeEvent());
    analytics.flush();

    const result = analytics.cleanup(90);
    expect(result.deleted).toBe(0);

    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events').get() as { c: number }).c;
    expect(count).toBe(1);
  });
});

// ==================== Shutdown ====================

describe('WyrmAnalytics — Shutdown', () => {
  it('flushes remaining buffer on shutdown', () => {
    const { analytics, db } = createTestAnalytics();
    analytics.record(makeEvent());
    analytics.record(makeEvent());
    // Don't call flush — shutdown should handle it
    analytics.shutdown();

    const count = (db.prepare('SELECT COUNT(*) as c FROM usage_events').get() as { c: number }).c;
    expect(count).toBe(2);
    db.close();
  });
});
