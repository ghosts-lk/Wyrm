/**
 * Wyrm CLI - Beautiful command-line interface
 * 
 * @module cli
 * @version 3.0.0
 */

// ANSI color codes
export const colors = {
  // Reset
  reset: '\x1b[0m',
  
  // Styles
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  
  // Colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
  
  // Bright colors
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  
  // Background
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
};

// Helper functions
export const c = {
  bold: (s: string) => `${colors.bold}${s}${colors.reset}`,
  dim: (s: string) => `${colors.dim}${s}${colors.reset}`,
  red: (s: string) => `${colors.red}${s}${colors.reset}`,
  green: (s: string) => `${colors.green}${s}${colors.reset}`,
  yellow: (s: string) => `${colors.yellow}${s}${colors.reset}`,
  blue: (s: string) => `${colors.blue}${s}${colors.reset}`,
  magenta: (s: string) => `${colors.magenta}${s}${colors.reset}`,
  cyan: (s: string) => `${colors.cyan}${s}${colors.reset}`,
  primary: (s: string) => `${colors.brightMagenta}${s}${colors.reset}`,
  success: (s: string) => `${colors.brightGreen}${s}${colors.reset}`,
  warning: (s: string) => `${colors.brightYellow}${s}${colors.reset}`,
  error: (s: string) => `${colors.brightRed}${s}${colors.reset}`,
};

// Icons
export const icons = {
  dragon: '🐉',
  fire: '🔥',
  scroll: '📜',
  sword: '⚔️',
  shield: '🛡️',
  treasure: '💎',
  quest: '🎯',
  check: '✓',
  cross: '✗',
  arrow: '→',
  bullet: '•',
  star: '★',
  warning: '⚠️',
  error: '❌',
  success: '✅',
  info: 'ℹ️',
  clock: '🕐',
  folder: '📁',
  file: '📄',
  lock: '🔒',
  unlock: '🔓',
  sync: '🔄',
  search: '🔍',
  sparkle: '✨',
};

// Priority icons
export const priorityIcons: Record<string, string> = {
  critical: '🔴',
  high: '🟠',
  medium: '🟡',
  low: '🟢',
};

// ASCII art banner
export const BANNER = `
${colors.brightMagenta}██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗${colors.reset}
${colors.brightMagenta}██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║${colors.reset}
${colors.brightMagenta}██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║${colors.reset}
${colors.brightMagenta}██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║${colors.reset}
${colors.brightMagenta}╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║${colors.reset}
${colors.brightMagenta} ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝${colors.reset}
${colors.dim}    Persistent AI Memory System v3.0.0${colors.reset}
${colors.dim}           ghosts.lk${colors.reset}
`;

export const MINI_BANNER = `${colors.brightMagenta}🐉 Wyrm v3.0.0${colors.reset}`;

/**
 * Progress spinner
 */
export class Spinner {
  private frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
  private current = 0;
  private interval: NodeJS.Timeout | null = null;
  private text: string;

  constructor(text = 'Loading...') {
    this.text = text;
  }

  start(): void {
    this.interval = setInterval(() => {
      process.stdout.write(`\r${colors.cyan}${this.frames[this.current]}${colors.reset} ${this.text}`);
      this.current = (this.current + 1) % this.frames.length;
    }, 80);
  }

  update(text: string): void {
    this.text = text;
  }

  succeed(text?: string): void {
    this.stop();
    console.log(`\r${c.success('✓')} ${text || this.text}`);
  }

  fail(text?: string): void {
    this.stop();
    console.log(`\r${c.error('✗')} ${text || this.text}`);
  }

  warn(text?: string): void {
    this.stop();
    console.log(`\r${c.warning('!')} ${text || this.text}`);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
      process.stdout.write('\r\x1b[K'); // Clear line
    }
  }
}

/**
 * Progress bar
 */
export class ProgressBar {
  private total: number;
  private current = 0;
  private width: number;
  private label: string;

  constructor(total: number, label = 'Progress', width = 30) {
    this.total = total;
    this.width = width;
    this.label = label;
  }

  update(current: number, label?: string): void {
    this.current = current;
    if (label) this.label = label;
    this.render();
  }

  increment(label?: string): void {
    this.update(this.current + 1, label);
  }

  private render(): void {
    const percent = Math.min(100, Math.floor((this.current / this.total) * 100));
    const filled = Math.floor((this.current / this.total) * this.width);
    const empty = this.width - filled;
    
    const bar = `${colors.brightMagenta}${'█'.repeat(filled)}${colors.dim}${'░'.repeat(empty)}${colors.reset}`;
    const percentStr = `${percent}%`.padStart(4);
    
    process.stdout.write(`\r${this.label} ${bar} ${percentStr} (${this.current}/${this.total})`);
  }

  complete(): void {
    this.update(this.total);
    console.log(); // New line
  }
}

/**
 * Table formatter
 */
export function formatTable(
  headers: string[],
  rows: string[][],
  options: { padding?: number; border?: boolean } = {}
): string {
  const { padding = 2, border = true } = options;
  
  // Calculate column widths
  const widths = headers.map((h, i) => {
    const maxRow = Math.max(...rows.map(r => (r[i] || '').length));
    return Math.max(h.length, maxRow);
  });

  const pad = (s: string, w: number) => s.padEnd(w);
  const sep = widths.map(w => '─'.repeat(w + padding)).join(border ? '┼' : ' ');
  
  let output = '';
  
  // Header
  if (border) {
    output += `${colors.dim}┌${widths.map(w => '─'.repeat(w + padding)).join('┬')}┐${colors.reset}\n`;
  }
  output += (border ? `${colors.dim}│${colors.reset}` : '') + 
    headers.map((h, i) => ` ${c.bold(pad(h, widths[i]))} `).join(border ? `${colors.dim}│${colors.reset}` : '') + 
    (border ? `${colors.dim}│${colors.reset}` : '') + '\n';
  
  if (border) {
    output += `${colors.dim}├${sep}┤${colors.reset}\n`;
  }
  
  // Rows
  for (const row of rows) {
    output += (border ? `${colors.dim}│${colors.reset}` : '') +
      row.map((cell, i) => ` ${pad(cell || '', widths[i])} `).join(border ? `${colors.dim}│${colors.reset}` : '') +
      (border ? `${colors.dim}│${colors.reset}` : '') + '\n';
  }
  
  if (border) {
    output += `${colors.dim}└${widths.map(w => '─'.repeat(w + padding)).join('┴')}┘${colors.reset}`;
  }
  
  return output;
}

/**
 * Box formatter
 */
export function formatBox(title: string, content: string, width = 50): string {
  const lines = content.split('\n');
  const maxLen = Math.max(title.length, ...lines.map(l => l.length), width);
  
  let output = `${colors.dim}╭${'─'.repeat(maxLen + 2)}╮${colors.reset}\n`;
  output += `${colors.dim}│${colors.reset} ${c.bold(title.padEnd(maxLen))} ${colors.dim}│${colors.reset}\n`;
  output += `${colors.dim}├${'─'.repeat(maxLen + 2)}┤${colors.reset}\n`;
  
  for (const line of lines) {
    output += `${colors.dim}│${colors.reset} ${line.padEnd(maxLen)} ${colors.dim}│${colors.reset}\n`;
  }
  
  output += `${colors.dim}╰${'─'.repeat(maxLen + 2)}╯${colors.reset}`;
  
  return output;
}

/**
 * Format bytes to human readable
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Format duration
 */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
  return `${Math.floor(ms / 3600000)}h ${Math.floor((ms % 3600000) / 60000)}m`;
}

/**
 * Print section header
 */
export function printSection(title: string): void {
  console.log(`\n${c.bold(c.primary(`▶ ${title}`))}`);
  console.log(`${colors.dim}${'─'.repeat(title.length + 4)}${colors.reset}`);
}

/**
 * Print success message
 */
export function printSuccess(message: string): void {
  console.log(`${icons.success} ${c.success(message)}`);
}

/**
 * Print error message
 */
export function printError(message: string): void {
  console.log(`${icons.error} ${c.error(message)}`);
}

/**
 * Print warning message
 */
export function printWarning(message: string): void {
  console.log(`${icons.warning} ${c.warning(message)}`);
}

/**
 * Print info message
 */
export function printInfo(message: string): void {
  console.log(`${icons.info} ${message}`);
}
