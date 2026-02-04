/**
 * Wyrm HTTP Authentication - Secure API access control
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module http-auth
 * @version 3.0.0
 */

import { IncomingMessage, ServerResponse } from 'http';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { randomBytes, createHash } from 'crypto';
import { WyrmLogger } from './logger.js';

// ==================== TYPES ====================

interface HttpAuthConfig {
  apiKeyHash: string;
  allowedOrigins: string[];
  rateLimit: {
    enabled: boolean;
    requests: number;
    windowMs: number;
  };
  requireAuth: boolean;
  devMode: boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// ==================== CONSTANTS ====================

const CONFIG_DIR = join(homedir(), '.wyrm');
const CONFIG_PATH = join(CONFIG_DIR, 'http-config.json');
const DEFAULT_RATE_LIMIT = { enabled: true, requests: 100, windowMs: 60000 };
const DEFAULT_ORIGINS = ['http://localhost:3333', 'http://127.0.0.1:3333'];

// ==================== STATE ====================

const rateLimitStore = new Map<string, RateLimitEntry>();
let config: HttpAuthConfig | null = null;
const logger = new WyrmLogger();

// ==================== HELPER FUNCTIONS ====================

/**
 * Hash a token for secure storage
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

/**
 * Load or create authentication configuration
 */
function loadOrCreateConfig(): HttpAuthConfig {
  // Ensure config directory exists
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  }
  
  // Load existing config
  if (existsSync(CONFIG_PATH)) {
    try {
      const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf-8'));
      return {
        apiKeyHash: data.apiKeyHash,
        allowedOrigins: data.allowedOrigins || DEFAULT_ORIGINS,
        rateLimit: { ...DEFAULT_RATE_LIMIT, ...data.rateLimit },
        requireAuth: data.requireAuth ?? true,
        devMode: process.env.WYRM_DEV === 'true',
      };
    } catch (error) {
      logger.error('Failed to load HTTP config, regenerating', { error: (error as Error).message });
    }
  }
  
  // Generate new API key
  const apiKey = randomBytes(32).toString('hex');
  
  logger.info('Generated new API key for HTTP server');
  console.log('\n' + '═'.repeat(60));
  console.log('🔐 WYRM API KEY (save this securely, shown once):');
  console.log('');
  console.log(`   ${apiKey}`);
  console.log('');
  console.log('   Use with: Authorization: Bearer <key>');
  console.log('═'.repeat(60) + '\n');
  
  const newConfig: HttpAuthConfig = {
    apiKeyHash: hashToken(apiKey),
    allowedOrigins: DEFAULT_ORIGINS,
    rateLimit: DEFAULT_RATE_LIMIT,
    requireAuth: true,
    devMode: process.env.WYRM_DEV === 'true',
  };
  
  // Save config with restrictive permissions
  writeFileSync(CONFIG_PATH, JSON.stringify(newConfig, null, 2), { mode: 0o600 });
  
  return newConfig;
}

/**
 * Get configuration (lazy load)
 */
function getConfig(): HttpAuthConfig {
  if (!config) {
    config = loadOrCreateConfig();
  }
  return config;
}

// ==================== AUTHENTICATION ====================

/**
 * Validate API key from Authorization header
 */
export function authenticate(req: IncomingMessage): boolean {
  const cfg = getConfig();
  
  // Dev mode: allow local connections without auth
  if (cfg.devMode) {
    const remoteAddr = req.socket.remoteAddress;
    if (remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1') {
      return true;
    }
  }
  
  // Check if auth is required
  if (!cfg.requireAuth) {
    logger.warn('Authentication disabled - API is open');
    return true;
  }
  
  // Validate Authorization header
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.slice(7);
  if (!token || token.length < 32) {
    return false;
  }
  
  // Constant-time comparison
  const tokenHash = hashToken(token);
  return constantTimeCompare(tokenHash, cfg.apiKeyHash);
}

// ==================== RATE LIMITING ====================

/**
 * Check and update rate limit for a client
 */
export function checkRateLimit(req: IncomingMessage): {
  allowed: boolean;
  remaining: number;
  resetAt: number;
} {
  const cfg = getConfig();
  
  if (!cfg.rateLimit.enabled) {
    return { allowed: true, remaining: Infinity, resetAt: 0 };
  }
  
  const clientId = req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  
  // Clean up expired entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [key, entry] of rateLimitStore) {
      if (entry.resetAt < now) {
        rateLimitStore.delete(key);
      }
    }
  }
  
  let entry = rateLimitStore.get(clientId);
  
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + cfg.rateLimit.windowMs };
    rateLimitStore.set(clientId, entry);
  }
  
  entry.count++;
  
  return {
    allowed: entry.count <= cfg.rateLimit.requests,
    remaining: Math.max(0, cfg.rateLimit.requests - entry.count),
    resetAt: entry.resetAt,
  };
}

// ==================== CORS ====================

/**
 * Get CORS origin for response
 */
export function getCorsOrigin(req: IncomingMessage): string {
  const cfg = getConfig();
  const origin = req.headers['origin'] as string | undefined;
  
  if (origin && cfg.allowedOrigins.includes(origin)) {
    return origin;
  }
  
  // Return first allowed origin if request origin not in list
  return cfg.allowedOrigins[0];
}

/**
 * Get security headers for response
 */
export function getSecurityHeaders(req: IncomingMessage): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': getCorsOrigin(req),
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Cache-Control': 'no-store',
  };
}

// ==================== MIDDLEWARE ====================

/**
 * Authentication middleware for HTTP server
 * Returns error response if auth fails, null if auth passes
 */
export function authMiddleware(
  req: IncomingMessage,
  res: ServerResponse
): { error: boolean; status?: number; message?: string } {
  
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    const headers = getSecurityHeaders(req);
    res.writeHead(204, headers);
    res.end();
    return { error: true }; // Request handled, stop processing
  }
  
  // Check rate limit
  const rateLimit = checkRateLimit(req);
  if (!rateLimit.allowed) {
    const headers = getSecurityHeaders(req);
    res.writeHead(429, {
      ...headers,
      'X-RateLimit-Remaining': '0',
      'X-RateLimit-Reset': String(rateLimit.resetAt),
      'Retry-After': String(Math.ceil((rateLimit.resetAt - Date.now()) / 1000)),
    });
    res.end(JSON.stringify({ error: 'Rate limit exceeded' }));
    
    logger.warn('Rate limit exceeded', { 
      ip: req.socket.remoteAddress,
      path: req.url,
    });
    
    return { error: true };
  }
  
  // Check authentication
  if (!authenticate(req)) {
    const headers = getSecurityHeaders(req);
    res.writeHead(401, {
      ...headers,
      'WWW-Authenticate': 'Bearer realm="Wyrm API"',
    });
    res.end(JSON.stringify({ error: 'Unauthorized' }));
    
    logger.warn('Authentication failed', {
      ip: req.socket.remoteAddress,
      path: req.url,
    });
    
    return { error: true };
  }
  
  // Add rate limit headers to successful response later
  return { error: false };
}

// ==================== CONFIGURATION MANAGEMENT ====================

/**
 * Regenerate API key
 */
export function regenerateApiKey(): string {
  const apiKey = randomBytes(32).toString('hex');
  
  const cfg = getConfig();
  cfg.apiKeyHash = hashToken(apiKey);
  
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  config = cfg;
  
  logger.info('API key regenerated');
  
  return apiKey;
}

/**
 * Update allowed CORS origins
 */
export function setAllowedOrigins(origins: string[]): void {
  const cfg = getConfig();
  cfg.allowedOrigins = origins;
  
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  config = cfg;
  
  logger.info('CORS origins updated', { origins });
}

/**
 * Update rate limit configuration
 */
export function setRateLimit(requests: number, windowMs: number): void {
  const cfg = getConfig();
  cfg.rateLimit = { enabled: true, requests, windowMs };
  
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  config = cfg;
  
  logger.info('Rate limit updated', { requests, windowMs });
}

/**
 * Enable/disable authentication requirement
 */
export function setRequireAuth(require: boolean): void {
  const cfg = getConfig();
  cfg.requireAuth = require;
  
  writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  config = cfg;
  
  if (!require) {
    logger.warn('Authentication disabled - API is now open');
  }
}

/**
 * Get current configuration (without exposing API key hash)
 */
export function getAuthStatus(): {
  requireAuth: boolean;
  devMode: boolean;
  rateLimit: { enabled: boolean; requests: number; windowMs: number };
  allowedOrigins: string[];
} {
  const cfg = getConfig();
  return {
    requireAuth: cfg.requireAuth,
    devMode: cfg.devMode,
    rateLimit: cfg.rateLimit,
    allowedOrigins: cfg.allowedOrigins,
  };
}
