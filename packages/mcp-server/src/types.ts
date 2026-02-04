/**
 * Wyrm Types - Core type definitions
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module types
 * @version 3.0.0
 */

// ==================== CORE ENTITIES ====================

export interface Project {
  id: number;
  name: string;
  path: string;
  repo?: string;
  stack?: string;
  last_commit?: string;
  branch?: string;
  description?: string;
  tags?: string;
  encrypted?: boolean;
  created_at: string;
  updated_at: string;
}

export interface Session {
  id: number;
  project_id: number;
  date: string;
  objectives: string;
  completed: string;
  issues: string;
  commits: string;
  files_changed: string;
  notes: string;
  summary?: string;
  tokens_estimate?: number;
  is_archived: boolean;
  created_at: string;
}

export interface Quest {
  id: number;
  project_id: number;
  title: string;
  description: string;
  priority: QuestPriority;
  status: QuestStatus;
  tags?: string;
  due_date?: string;
  assignee?: string;
  created_at: string;
  completed_at?: string;
}

export interface Context {
  id: number;
  project_id: number;
  key: string;
  value: string;
  encrypted?: boolean;
  updated_at: string;
}

export interface DataPoint {
  id: number;
  project_id: number;
  category: string;
  key: string;
  value: string;
  metadata?: string;
  created_at: string;
}

export interface WatchDir {
  id: number;
  path: string;
  recursive: boolean;
  last_scan: string;
}

// ==================== ENUMS ====================

export type QuestPriority = 'critical' | 'high' | 'medium' | 'low';
export type QuestStatus = 'pending' | 'in_progress' | 'completed' | 'abandoned';
export type SyncDirection = 'import' | 'export' | 'both';
export type SearchType = 'all' | 'sessions' | 'quests' | 'data';

// ==================== API TYPES ====================

export interface WyrmStats {
  projects: number;
  sessions: number;
  quests: number;
  dataPoints: number;
  totalTokens: number;
  dbSize: string;
  version: string;
  uptime?: number;
}

export interface ProjectStats {
  sessions: number;
  quests: { pending: number; completed: number };
  dataPoints: number;
  tokens: number;
}

export interface SearchResult {
  type: 'session' | 'quest' | 'data' | 'context';
  id: number;
  projectId: number;
  projectName?: string;
  title: string;
  snippet: string;
  score?: number;
}

// ==================== REQUEST/RESPONSE ====================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  correlationId?: string;
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ==================== TOOL ARGUMENTS ====================

export interface ScanProjectsArgs {
  path: string;
  watch?: boolean;
  recursive?: boolean;
}

export interface ListProjectsArgs {
  search?: string;
  limit?: number;
  offset?: number;
}

export interface ProjectContextArgs {
  projectPath?: string;
  projectName?: string;
  includeArchived?: boolean;
}

export interface SessionStartArgs {
  projectPath: string;
  objectives?: string;
}

export interface SessionUpdateArgs {
  projectPath: string;
  completed?: string;
  issues?: string;
  commits?: string;
  notes?: string;
}

export interface QuestAddArgs {
  projectPath: string;
  title: string;
  description?: string;
  priority?: QuestPriority;
  tags?: string;
  dueDate?: string;
}

export interface DataInsertArgs {
  projectPath: string;
  category: string;
  key: string;
  value: string;
  metadata?: Record<string, unknown>;
}

export interface DataQueryArgs {
  projectPath: string;
  category?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export interface SearchArgs {
  query: string;
  type?: SearchType;
  projectPath?: string;
  limit?: number;
}

export interface SyncArgs {
  projectPath?: string;
  direction?: SyncDirection;
}

export interface MaintenanceArgs {
  vacuum?: boolean;
  archiveDays?: number;
  reindex?: boolean;
}

// ==================== CONFIG ====================

export interface WyrmConfig {
  database: {
    path?: string;
    wal?: boolean;
    cacheSize?: number;
  };
  encryption: {
    enabled: boolean;
    keyFile?: string;
  };
  logging: {
    level: 'debug' | 'info' | 'warn' | 'error';
    file?: string;
    console?: boolean;
  };
  http: {
    port: number;
    host: string;
    cors?: boolean;
  };
  sync: {
    autoImport?: boolean;
    autoExport?: boolean;
    interval?: number;
  };
}

export const DEFAULT_CONFIG: WyrmConfig = {
  database: {
    wal: true,
    cacheSize: 64000,
  },
  encryption: {
    enabled: false,
  },
  logging: {
    level: 'info',
    console: true,
  },
  http: {
    port: 3333,
    host: '127.0.0.1',
  },
  sync: {
    autoImport: true,
    autoExport: false,
  },
};

// ==================== MCP TOOL DEFINITIONS ====================

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, {
      type: string;
      description?: string;
      enum?: string[];
      items?: unknown;
    }>;
    required?: string[];
  };
}

// ==================== EVENTS ====================

export type WyrmEvent = 
  | { type: 'project:created'; project: Project }
  | { type: 'project:updated'; project: Project }
  | { type: 'session:created'; session: Session }
  | { type: 'session:updated'; session: Session }
  | { type: 'quest:created'; quest: Quest }
  | { type: 'quest:completed'; quest: Quest }
  | { type: 'data:inserted'; count: number; projectId: number }
  | { type: 'sync:completed'; direction: SyncDirection; projects: number };

export type EventHandler = (event: WyrmEvent) => void;
