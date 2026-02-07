#!/usr/bin/env node
/**
 * Wyrm Setup CLI - Auto-configure Wyrm for any AI client
 * 
 * Usage:
 *   wyrm-setup              Auto-detect and configure all AI clients
 *   wyrm-setup --check      Show current configuration status
 *   wyrm-setup --remove     Remove Wyrm from all AI clients
 *   wyrm-setup --only X,Y   Configure specific clients only
 *   wyrm-setup --server P   Override server path
 *   wyrm-setup --db P       Override database path
 *   wyrm-setup --reconf     Re-configure previously configured clients
 *   wyrm-setup --list       List all supported AI clients
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module setup
 * @version 3.0.0
 */

import {
  detectClients,
  autoConfigureAll,
  removeFromAll,
  configureSpecific,
  reconfAll,
  getStatusSummary,
  findWyrmServerPath,
  getDefaultDbPath,
  loadWyrmMeta,
} from './autoconfig.js';
import { colors, c, icons, BANNER, MINI_BANNER, formatBox, printSuccess, printError, printWarning, printInfo, printSection } from './cli.js';
import type { SetupResult } from './autoconfig.js';

// ==================== ARGUMENT PARSING ====================

interface SetupArgs {
  command: 'auto' | 'check' | 'remove' | 'only' | 'reconf' | 'list' | 'help';
  clientIds?: string[];
  serverPath?: string;
  dbPath?: string;
}

function parseArgs(argv: string[]): SetupArgs {
  const args = argv.slice(2); // Skip node and script path

  if (args.length === 0) {
    return { command: 'auto' };
  }

  const result: SetupArgs = { command: 'auto' };

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--check':
      case '-c':
      case 'check':
      case 'status':
        result.command = 'check';
        break;

      case '--remove':
      case '-r':
      case 'remove':
      case 'uninstall':
        result.command = 'remove';
        break;

      case '--only':
      case '-o':
      case 'only':
        result.command = 'only';
        if (args[i + 1]) {
          result.clientIds = args[i + 1].split(',').map(s => s.trim());
          i++;
        }
        break;

      case '--reconf':
      case '--reconfigure':
      case 'reconf':
        result.command = 'reconf';
        break;

      case '--list':
      case '-l':
      case 'list':
        result.command = 'list';
        break;

      case '--server':
      case '-s':
        if (args[i + 1]) {
          result.serverPath = args[i + 1];
          i++;
        }
        break;

      case '--db':
      case '-d':
        if (args[i + 1]) {
          result.dbPath = args[i + 1];
          i++;
        }
        break;

      case '--help':
      case '-h':
      case 'help':
        result.command = 'help';
        break;
    }
  }

  return result;
}

// ==================== OUTPUT ====================

function printResults(results: SetupResult[]): void {
  console.log('');
  
  const configured = results.filter(r => r.action === 'configured');
  const updated = results.filter(r => r.action === 'updated');
  const skipped = results.filter(r => r.action === 'skipped');
  const failed = results.filter(r => r.action === 'failed');

  for (const r of configured) {
    console.log(`  ${icons.success} ${r.client.icon} ${c.green(r.client.name)} — ${c.success('configured')}`);
    if (r.backup) console.log(`    ${c.dim(`backup → ${r.backup}`)}`);
  }

  for (const r of updated) {
    console.log(`  ${icons.sync} ${r.client.icon} ${c.blue(r.client.name)} — ${c.cyan('updated')}`);
    if (r.backup) console.log(`    ${c.dim(`backup → ${r.backup}`)}`);
  }

  for (const r of skipped) {
    console.log(`  ${c.dim(`  ○ ${r.client.icon} ${r.client.name} — ${r.message}`)}`);
  }

  for (const r of failed) {
    console.log(`  ${icons.error} ${r.client.icon} ${c.red(r.client.name)} — ${c.error(r.message)}`);
  }

  console.log('');

  const successCount = configured.length + updated.length;
  if (successCount > 0) {
    console.log(`  ${c.success(`${icons.dragon} Wyrm connected to ${successCount} AI client(s)`)}`);
    console.log(`  ${c.dim('Switch AIs anytime — run wyrm-setup again to reconnect')}`);
  } else if (failed.length > 0) {
    console.log(`  ${c.error('Some configurations failed. Check errors above.')}`);
  } else {
    console.log(`  ${c.dim('No AI clients detected. Install one and try again.')}`);
  }

  console.log('');
}

function printHelp(): void {
  console.log(MINI_BANNER);
  console.log('');
  console.log(`${c.bold('Usage:')} wyrm-setup ${c.dim('[command] [options]')}`);
  console.log('');
  console.log(`${c.bold('Commands:')}`);
  console.log(`  ${c.cyan('(no args)')}      Auto-detect and configure all AI clients`);
  console.log(`  ${c.cyan('check')}          Show current configuration status`);
  console.log(`  ${c.cyan('list')}           List all supported AI clients`);
  console.log(`  ${c.cyan('remove')}         Remove Wyrm from all AI clients`);
  console.log(`  ${c.cyan('reconf')}         Re-configure previously configured clients`);
  console.log(`  ${c.cyan('only X,Y')}       Configure specific clients only`);
  console.log(`  ${c.cyan('help')}           Show this help message`);
  console.log('');
  console.log(`${c.bold('Options:')}`);
  console.log(`  ${c.cyan('--server P')}     Override Wyrm MCP server path`);
  console.log(`  ${c.cyan('--db P')}         Override Wyrm database path`);
  console.log('');
  console.log(`${c.bold('Client IDs:')}`);
  const clients = detectClients();
  for (const cl of clients) {
    console.log(`  ${cl.icon} ${c.cyan(cl.id.padEnd(18))} ${cl.name}`);
  }
  console.log('');
  console.log(`${c.bold('Examples:')}`);
  console.log(`  wyrm-setup                                   ${c.dim('# Auto-configure everything')}`);
  console.log(`  wyrm-setup check                             ${c.dim('# See what\'s configured')}`);
  console.log(`  wyrm-setup only vscode-copilot,cursor         ${c.dim('# Only VS Code + Cursor')}`);
  console.log(`  wyrm-setup --server /path/to/wyrm/dist/index.js  ${c.dim('# Custom server path')}`);
  console.log(`  wyrm-setup remove                            ${c.dim('# Remove from all clients')}`);
  console.log('');
}

function printClientList(): void {
  console.log(MINI_BANNER);
  console.log('');
  printSection('Supported AI Clients');
  console.log('');

  const clients = detectClients();
  
  for (const cl of clients) {
    const status = cl.detected
      ? cl.configured
        ? c.success('● connected')
        : c.yellow('◐ available')
      : c.dim('○ not found');

    const versionStr = cl.version ? ` ${c.dim(`v${cl.version}`)}` : '';
    
    console.log(`  ${cl.icon} ${c.bold(cl.name.padEnd(20))} ${c.cyan(cl.id.padEnd(18))} ${status}${versionStr}`);
    console.log(`    ${c.dim(`Config: ${cl.configPath}`)}`);
  }
  
  console.log('');
}

// ==================== MAIN ====================

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  switch (args.command) {
    case 'help':
      printHelp();
      break;

    case 'check': {
      console.log(MINI_BANNER);
      console.log('');
      console.log(getStatusSummary());
      break;
    }

    case 'list':
      printClientList();
      break;

    case 'auto': {
      console.log(BANNER);
      printSection('Auto-Configure');
      console.log('');

      const serverPath = args.serverPath || findWyrmServerPath();
      const dbPath = args.dbPath || getDefaultDbPath();
      
      console.log(`  ${icons.sword} Server: ${c.cyan(serverPath)}`);
      console.log(`  ${icons.treasure} DB:     ${c.cyan(dbPath)}`);
      console.log('');
      console.log(`  ${c.dim('Scanning for AI clients...')}`);

      const results = autoConfigureAll({
        serverPath,
        dbPath,
      });

      printResults(results);
      break;
    }

    case 'only': {
      if (!args.clientIds || args.clientIds.length === 0) {
        printError('No client IDs specified. Use: wyrm-setup only vscode-copilot,cursor');
        process.exit(1);
      }

      console.log(MINI_BANNER);
      printSection(`Configure: ${args.clientIds.join(', ')}`);

      const results = configureSpecific(args.clientIds, {
        serverPath: args.serverPath,
        dbPath: args.dbPath,
      });

      printResults(results);
      break;
    }

    case 'remove': {
      console.log(MINI_BANNER);
      printSection('Remove Wyrm from AI Clients');
      console.log('');
      console.log(`  ${c.warning('Removing Wyrm configuration from all AI clients...')}`);

      const results = removeFromAll();
      
      const removed = results.filter(r => r.action === 'configured');
      const skipped = results.filter(r => r.action === 'skipped');

      for (const r of removed) {
        console.log(`  ${icons.check} ${r.client.icon} ${r.client.name} — removed`);
        if (r.backup) console.log(`    ${c.dim(`backup → ${r.backup}`)}`);
      }

      for (const r of skipped) {
        console.log(`  ${c.dim(`  ○ ${r.client.icon} ${r.client.name} — ${r.message}`)}`);
      }

      console.log('');
      if (removed.length > 0) {
        console.log(`  ${c.success(`Removed from ${removed.length} client(s). Run wyrm-setup to reconnect.`)}`);
      }
      console.log('');
      break;
    }

    case 'reconf': {
      console.log(MINI_BANNER);
      printSection('Re-Configure');
      
      const meta = loadWyrmMeta();
      if (meta) {
        console.log(`  ${c.dim(`Restoring config for: ${meta.configuredClients.join(', ')}`)}`);
      } else {
        console.log(`  ${c.dim('No previous config found — running full auto-configure')}`);
      }

      const results = reconfAll();
      printResults(results);
      break;
    }
  }
}

main().catch((err) => {
  printError(`Setup failed: ${err}`);
  process.exit(1);
});
