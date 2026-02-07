/**
 * Wyrm Auto-Configure - Universal AI Client Detection & Setup
 * 
 * Automatically detects installed AI clients (VS Code Copilot, Claude Desktop,
 * Cursor, Windsurf, Zed, etc.) and configures Wyrm's MCP server in each.
 * Handles provider switching seamlessly — change your AI, Wyrm follows.
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module autoconfig
 * @version 3.0.0
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { homedir, platform } from 'os';
import { join, dirname, resolve } from 'path';
import { execSync, spawnSync } from 'child_process';

// ==================== TYPES ====================

export interface AIClient {
  id: string;
  name: string;
  icon: string;
  configPath: string;
  configFormat: 'vscode' | 'mcp-json' | 'zed';
  mcpKey: string;           // Key path for MCP servers in config
  detected: boolean;
  configured: boolean;
  version?: string;
}

export interface SetupResult {
  client: AIClient;
  action: 'configured' | 'updated' | 'skipped' | 'failed';
  message: string;
  backup?: string;
}

export interface WyrmConfig {
  serverPath: string;
  dbPath: string;
  httpPort?: number;
}

// ==================== CLIENT DEFINITIONS ====================

function getConfigPaths(): AIClient[] {
  const home = homedir();
  const os = platform();

  // Base config directories per OS
  const vscodeBase = os === 'darwin' 
    ? join(home, 'Library', 'Application Support', 'Code', 'User')
    : os === 'win32'
    ? join(home, 'AppData', 'Roaming', 'Code', 'User')
    : join(home, '.config', 'Code', 'User');

  const vscodeInsidersBase = os === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Code - Insiders', 'User')
    : os === 'win32'
    ? join(home, 'AppData', 'Roaming', 'Code - Insiders', 'User')
    : join(home, '.config', 'Code - Insiders', 'User');

  const claudeBase = os === 'darwin'
    ? join(home, 'Library', 'Application Support', 'Claude')
    : os === 'win32'
    ? join(home, 'AppData', 'Roaming', 'Claude')
    : join(home, '.config', 'claude');

  const cursorBase = os === 'darwin'
    ? join(home, '.cursor')
    : os === 'win32'
    ? join(home, '.cursor')
    : join(home, '.cursor');

  const windsurfBase = os === 'darwin'
    ? join(home, '.codeium', 'windsurf')
    : os === 'win32'
    ? join(home, '.codeium', 'windsurf')
    : join(home, '.codeium', 'windsurf');

  const zedBase = os === 'darwin'
    ? join(home, '.config', 'zed')
    : os === 'win32'
    ? join(home, 'AppData', 'Roaming', 'Zed')
    : join(home, '.config', 'zed');

  const continueBase = join(home, '.continue');

  return [
    {
      id: 'vscode-copilot',
      name: 'VS Code (Copilot)',
      icon: '💻',
      configPath: join(vscodeBase, 'settings.json'),
      configFormat: 'vscode',
      mcpKey: 'mcp.servers',
      detected: false,
      configured: false,
    },
    {
      id: 'vscode-insiders',
      name: 'VS Code Insiders',
      icon: '🟢',
      configPath: join(vscodeInsidersBase, 'settings.json'),
      configFormat: 'vscode',
      mcpKey: 'mcp.servers',
      detected: false,
      configured: false,
    },
    {
      id: 'claude-desktop',
      name: 'Claude Desktop',
      icon: '🤖',
      configPath: join(claudeBase, 'claude_desktop_config.json'),
      configFormat: 'mcp-json',
      mcpKey: 'mcpServers',
      detected: false,
      configured: false,
    },
    {
      id: 'cursor',
      name: 'Cursor',
      icon: '📐',
      configPath: join(cursorBase, 'mcp.json'),
      configFormat: 'mcp-json',
      mcpKey: 'mcpServers',
      detected: false,
      configured: false,
    },
    {
      id: 'windsurf',
      name: 'Windsurf',
      icon: '🏄',
      configPath: join(windsurfBase, 'mcp_config.json'),
      configFormat: 'mcp-json',
      mcpKey: 'mcpServers',
      detected: false,
      configured: false,
    },
    {
      id: 'zed',
      name: 'Zed',
      icon: '⚡',
      configPath: join(zedBase, 'settings.json'),
      configFormat: 'zed',
      mcpKey: 'context_servers',
      detected: false,
      configured: false,
    },
    {
      id: 'continue',
      name: 'Continue',
      icon: '🔄',
      configPath: join(continueBase, 'config.json'),
      configFormat: 'mcp-json',
      mcpKey: 'mcpServers',
      detected: false,
      configured: false,
    },
  ];
}

// ==================== DETECTION ====================

/**
 * Detect which AI clients are installed by checking for their config directories
 */
export function detectClients(): AIClient[] {
  const clients = getConfigPaths();
  
  for (const client of clients) {
    // Check if config directory exists (the client is installed)
    const configDir = dirname(client.configPath);
    client.detected = existsSync(configDir);
    
    // Check if Wyrm is already configured
    if (client.detected && existsSync(client.configPath)) {
      try {
        const content = readFileSync(client.configPath, 'utf-8');
        const config = parseJsonWithComments(content);
        client.configured = hasWyrmConfig(config, client);
      } catch {
        client.configured = false;
      }
    }

    // Try to detect version
    if (client.detected) {
      client.version = detectClientVersion(client);
    }
  }
  
  return clients;
}

/**
 * Detect the version of an AI client
 */
function detectClientVersion(client: AIClient): string | undefined {
  try {
    switch (client.id) {
      case 'vscode-copilot':
      case 'vscode-insiders': {
        const cmd = client.id === 'vscode-insiders' ? 'code-insiders' : 'code';
        const result = spawnSync(cmd, ['--version'], { encoding: 'utf-8', timeout: 5000 });
        if (result.stdout) return result.stdout.split('\n')[0];
        break;
      }
      case 'cursor': {
        const result = spawnSync('cursor', ['--version'], { encoding: 'utf-8', timeout: 5000 });
        if (result.stdout) return result.stdout.split('\n')[0];
        break;
      }
    }
  } catch {
    // Version detection is optional
  }
  return undefined;
}

/**
 * Check if Wyrm is already configured in a client's config
 */
function hasWyrmConfig(config: Record<string, unknown>, client: AIClient): boolean {
  switch (client.configFormat) {
    case 'vscode': {
      const mcp = config['mcp'] as Record<string, unknown> | undefined;
      const servers = mcp?.['servers'] as Record<string, unknown> | undefined;
      return servers?.['wyrm'] !== undefined;
    }
    case 'mcp-json': {
      const servers = config[client.mcpKey] as Record<string, unknown> | undefined;
      return servers?.['wyrm'] !== undefined;
    }
    case 'zed': {
      const servers = config[client.mcpKey] as Record<string, unknown> | undefined;
      return servers?.['wyrm'] !== undefined;
    }
    default:
      return false;
  }
}

// ==================== CONFIGURATION ====================

/**
 * Auto-detect Wyrm server path
 */
export function findWyrmServerPath(): string {
  // 1. Check if wyrm-mcp binary is in PATH
  try {
    const result = spawnSync('which', ['wyrm-mcp'], { encoding: 'utf-8', timeout: 5000 });
    if (result.stdout?.trim()) {
      return result.stdout.trim();
    }
  } catch {}

  // 2. Check common npm global install locations
  try {
    const result = spawnSync('npm', ['root', '-g'], { encoding: 'utf-8', timeout: 5000 });
    const globalDir = result.stdout?.trim();
    if (globalDir) {
      const globalPath = join(globalDir, 'wyrm-mcp', 'dist', 'index.js');
      if (existsSync(globalPath)) return globalPath;
    }
  } catch {}

  // 3. Check local development path (relative to this file)
  const devPath = resolve(__dirname, 'index.js');
  if (existsSync(devPath)) return devPath;

  // 4. Check ~/.wyrm/node_modules
  const wyrmModulesPath = join(homedir(), '.wyrm', 'node_modules', 'wyrm-mcp', 'dist', 'index.js');
  if (existsSync(wyrmModulesPath)) return wyrmModulesPath;

  // 5. Check common project locations
  const projectLocations = [
    join(homedir(), 'Git Projects', 'Wyrm', 'packages', 'mcp-server', 'dist', 'index.js'),
    join(homedir(), 'projects', 'Wyrm', 'packages', 'mcp-server', 'dist', 'index.js'),
    join(homedir(), 'dev', 'Wyrm', 'packages', 'mcp-server', 'dist', 'index.js'),
  ];

  for (const loc of projectLocations) {
    if (existsSync(loc)) return loc;
  }

  // 6. Fallback to npx
  return 'wyrm-mcp';
}

/**
 * Get the default Wyrm database path
 */
export function getDefaultDbPath(): string {
  return join(homedir(), '.wyrm', 'wyrm.db');
}

/**
 * Build the Wyrm MCP config object for a specific client format
 */
function buildWyrmMcpConfig(client: AIClient, wyrmConfig: WyrmConfig): Record<string, unknown> {
  const serverPath = wyrmConfig.serverPath;
  const isNpx = serverPath === 'wyrm-mcp';
  const isJsFile = serverPath.endsWith('.js');

  switch (client.configFormat) {
    case 'vscode':
      return {
        command: isNpx ? 'npx' : 'node',
        args: isNpx ? ['wyrm-mcp'] : [serverPath],
        env: {
          WYRM_DB: wyrmConfig.dbPath,
        },
      };

    case 'mcp-json':
      return {
        command: isNpx ? 'npx' : 'node',
        args: isNpx ? ['wyrm-mcp'] : [serverPath],
        env: {
          WYRM_DB: wyrmConfig.dbPath,
        },
      };

    case 'zed':
      return {
        command: isNpx ? 'npx' : 'node',
        args: isNpx ? ['wyrm-mcp'] : [serverPath],
        env: {
          WYRM_DB: wyrmConfig.dbPath,
        },
      };

    default:
      return {};
  }
}

/**
 * Configure Wyrm in a single AI client
 */
export function configureClient(client: AIClient, wyrmConfig: WyrmConfig): SetupResult {
  if (!client.detected) {
    return {
      client,
      action: 'skipped',
      message: `${client.name} not detected`,
    };
  }

  try {
    // Ensure config directory exists
    const configDir = dirname(client.configPath);
    if (!existsSync(configDir)) {
      mkdirSync(configDir, { recursive: true });
    }

    // Read existing config or create new
    let config: Record<string, unknown> = {};
    let existed = false;
    
    if (existsSync(client.configPath)) {
      try {
        const content = readFileSync(client.configPath, 'utf-8');
        config = parseJsonWithComments(content);
        existed = true;
      } catch {
        // If config exists but is invalid, start fresh
        config = {};
      }
    }

    // Create backup before modifying
    let backupPath: string | undefined;
    if (existed) {
      backupPath = `${client.configPath}.wyrm-backup`;
      writeFileSync(backupPath, readFileSync(client.configPath));
    }

    // Build Wyrm MCP entry
    const wyrmEntry = buildWyrmMcpConfig(client, wyrmConfig);

    // Inject into config based on format
    switch (client.configFormat) {
      case 'vscode': {
        // VS Code: { "mcp": { "servers": { "wyrm": {...} } } }
        if (!config['mcp']) config['mcp'] = {};
        const mcp = config['mcp'] as Record<string, unknown>;
        if (!mcp['servers']) mcp['servers'] = {};
        const servers = mcp['servers'] as Record<string, unknown>;
        servers['wyrm'] = wyrmEntry;
        break;
      }

      case 'mcp-json': {
        // MCP JSON: { "mcpServers": { "wyrm": {...} } }
        if (!config[client.mcpKey]) config[client.mcpKey] = {};
        const servers = config[client.mcpKey] as Record<string, unknown>;
        servers['wyrm'] = wyrmEntry;
        break;
      }

      case 'zed': {
        // Zed: { "context_servers": { "wyrm": {...} } }
        if (!config[client.mcpKey]) config[client.mcpKey] = {};
        const servers = config[client.mcpKey] as Record<string, unknown>;
        servers['wyrm'] = wyrmEntry;
        break;
      }
    }

    // Write config back
    writeFileSync(client.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    const action = client.configured ? 'updated' : 'configured';
    client.configured = true;

    return {
      client,
      action,
      message: `${client.name} ${action === 'configured' ? 'configured' : 'updated'} successfully`,
      backup: backupPath,
    };
  } catch (error) {
    return {
      client,
      action: 'failed',
      message: `Failed to configure ${client.name}: ${error}`,
    };
  }
}

/**
 * Remove Wyrm from a single AI client
 */
export function removeFromClient(client: AIClient): SetupResult {
  if (!client.detected || !client.configured) {
    return {
      client,
      action: 'skipped',
      message: `${client.name} not configured`,
    };
  }

  try {
    if (!existsSync(client.configPath)) {
      return { client, action: 'skipped', message: `${client.name} config not found` };
    }

    const content = readFileSync(client.configPath, 'utf-8');
    const config = parseJsonWithComments(content);

    // Create backup
    const backupPath = `${client.configPath}.wyrm-backup`;
    writeFileSync(backupPath, content);

    // Remove Wyrm entry
    switch (client.configFormat) {
      case 'vscode': {
        const mcp = config['mcp'] as Record<string, unknown> | undefined;
        const servers = mcp?.['servers'] as Record<string, unknown> | undefined;
        if (servers) delete servers['wyrm'];
        break;
      }
      case 'mcp-json':
      case 'zed': {
        const servers = config[client.mcpKey] as Record<string, unknown> | undefined;
        if (servers) delete servers['wyrm'];
        break;
      }
    }

    writeFileSync(client.configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    client.configured = false;

    return {
      client,
      action: 'configured',
      message: `Removed Wyrm from ${client.name}`,
      backup: backupPath,
    };
  } catch (error) {
    return {
      client,
      action: 'failed',
      message: `Failed to remove from ${client.name}: ${error}`,
    };
  }
}

// ==================== ORCHESTRATION ====================

/**
 * Auto-configure Wyrm in ALL detected AI clients
 */
export function autoConfigureAll(wyrmConfig?: Partial<WyrmConfig>): SetupResult[] {
  const config: WyrmConfig = {
    serverPath: wyrmConfig?.serverPath || findWyrmServerPath(),
    dbPath: wyrmConfig?.dbPath || getDefaultDbPath(),
    httpPort: wyrmConfig?.httpPort,
  };

  // Ensure .wyrm directory exists
  const wyrmDir = join(homedir(), '.wyrm');
  if (!existsSync(wyrmDir)) {
    mkdirSync(wyrmDir, { recursive: true });
  }

  // Save Wyrm's own config for future reference
  saveWyrmMeta(config);

  const clients = detectClients();
  const results: SetupResult[] = [];

  for (const client of clients) {
    results.push(configureClient(client, config));
  }

  return results;
}

/**
 * Remove Wyrm from ALL AI clients
 */
export function removeFromAll(): SetupResult[] {
  const clients = detectClients();
  const results: SetupResult[] = [];

  for (const client of clients) {
    results.push(removeFromClient(client));
  }

  return results;
}

/**
 * Configure Wyrm in specific clients only
 */
export function configureSpecific(clientIds: string[], wyrmConfig?: Partial<WyrmConfig>): SetupResult[] {
  const config: WyrmConfig = {
    serverPath: wyrmConfig?.serverPath || findWyrmServerPath(),
    dbPath: wyrmConfig?.dbPath || getDefaultDbPath(),
    httpPort: wyrmConfig?.httpPort,
  };

  saveWyrmMeta(config);

  const clients = detectClients();
  const results: SetupResult[] = [];

  for (const client of clients) {
    if (clientIds.includes(client.id)) {
      results.push(configureClient(client, config));
    }
  }

  return results;
}

// ==================== META CONFIG ====================

interface WyrmMeta {
  version: string;
  serverPath: string;
  dbPath: string;
  httpPort?: number;
  configuredClients: string[];
  lastSetup: string;
  autoUpdate: boolean;
}

/**
 * Save Wyrm's meta configuration for auto-updates
 */
function saveWyrmMeta(config: WyrmConfig): void {
  const metaPath = join(homedir(), '.wyrm', 'wyrm-config.json');
  const clients = detectClients().filter(c => c.configured).map(c => c.id);
  
  const meta: WyrmMeta = {
    version: '3.0.0',
    serverPath: config.serverPath,
    dbPath: config.dbPath,
    httpPort: config.httpPort,
    configuredClients: clients,
    lastSetup: new Date().toISOString(),
    autoUpdate: true,
  };

  writeFileSync(metaPath, JSON.stringify(meta, null, 2) + '\n', 'utf-8');
}

/**
 * Load Wyrm's meta configuration
 */
export function loadWyrmMeta(): WyrmMeta | null {
  const metaPath = join(homedir(), '.wyrm', 'wyrm-config.json');
  if (!existsSync(metaPath)) return null;
  
  try {
    return JSON.parse(readFileSync(metaPath, 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * Re-configure all previously configured clients (for use after updates)
 */
export function reconfAll(): SetupResult[] {
  const meta = loadWyrmMeta();
  if (!meta) {
    return autoConfigureAll();
  }

  return configureSpecific(meta.configuredClients, {
    serverPath: meta.serverPath,
    dbPath: meta.dbPath,
    httpPort: meta.httpPort,
  });
}

// ==================== UTILITIES ====================

/**
 * Parse JSON with comments (JSONC) - handles VS Code settings files
 */
function parseJsonWithComments(text: string): Record<string, unknown> {
  // Strip single-line comments
  let cleaned = text.replace(/\/\/.*$/gm, '');
  // Strip multi-line comments
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');
  // Handle trailing commas (common in VS Code settings)
  cleaned = cleaned.replace(/,\s*([\]}])/g, '$1');
  
  return JSON.parse(cleaned);
}

/**
 * Get a friendly status summary of all AI clients
 */
export function getStatusSummary(): string {
  const clients = detectClients();
  const detected = clients.filter(c => c.detected);
  const configured = clients.filter(c => c.configured);

  let summary = `🐉 Wyrm Auto-Configure Status\n\n`;
  summary += `  Detected:   ${detected.length}/${clients.length} AI clients\n`;
  summary += `  Configured: ${configured.length}/${detected.length} clients\n\n`;

  for (const client of clients) {
    const status = !client.detected
      ? '  ○'  // Not installed
      : client.configured
      ? '  ●'  // Configured
      : '  ◐'; // Installed but not configured

    const versionStr = client.version ? ` (${client.version})` : '';
    const statusLabel = !client.detected
      ? 'not found'
      : client.configured
      ? 'configured ✓'
      : 'detected — not configured';

    summary += `${status} ${client.icon} ${client.name}${versionStr}: ${statusLabel}\n`;
  }

  const meta = loadWyrmMeta();
  if (meta) {
    summary += `\n  Server: ${meta.serverPath}\n`;
    summary += `  DB:     ${meta.dbPath}\n`;
    summary += `  Last:   ${new Date(meta.lastSetup).toLocaleString()}\n`;
  }

  return summary;
}
