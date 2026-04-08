/**
 * Wyrm Security Module - Input validation and path security
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module security
 * @version 3.0.0
 */

import { resolve, relative, normalize, sep } from 'path';
import { existsSync, statSync } from 'fs';
import { homedir } from 'os';
import { createHash } from 'crypto';

// ==================== PATH SECURITY ====================

/**
 * Validate and sanitize a path to prevent traversal attacks
 */
export function validatePath(basePath: string, targetPath: string): string {
  const normalizedBase = normalize(resolve(basePath));
  const normalizedTarget = normalize(resolve(basePath, targetPath));
  
  // Check if target is within base
  const rel = relative(normalizedBase, normalizedTarget);
  
  if (rel.startsWith('..') || rel.startsWith(sep)) {
    throw new SecurityError('Path traversal detected', 'PATH_TRAVERSAL');
  }
  
  // Double-check resolved path
  if (!normalizedTarget.startsWith(normalizedBase)) {
    throw new SecurityError('Path traversal detected', 'PATH_TRAVERSAL');
  }
  
  return normalizedTarget;
}

/**
 * Check if a path is a valid directory
 */
export function validateDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validate project path is within allowed directories
 */
export function validateProjectPath(projectPath: string): string {
  const normalizedPath = normalize(resolve(projectPath));
  
  // List of allowed root directories
  const allowedRoots = [
    normalize(resolve(homedir(), 'Git Projects')),
    normalize(resolve(homedir(), 'Projects')),
    normalize(resolve(homedir(), 'dev')),
    normalize(resolve(homedir(), 'code')),
    normalize(resolve(homedir(), 'repos')),
    normalize('/tmp/wyrm-test'), // For testing
  ];
  
  // Add from environment
  if (process.env.WYRM_ALLOWED_PATHS) {
    const envPaths = process.env.WYRM_ALLOWED_PATHS.split(':');
    for (const p of envPaths) {
      allowedRoots.push(normalize(resolve(p)));
    }
  }
  
  // Check if path is within an allowed root
  const isAllowed = allowedRoots.some(root => 
    normalizedPath === root || normalizedPath.startsWith(root + sep)
  );
  
  if (!isAllowed) {
    throw new SecurityError(
      'Project path not in allowed directories',
      'INVALID_PROJECT_PATH'
    );
  }
  
  if (!validateDirectory(normalizedPath)) {
    throw new SecurityError('Path is not a valid directory', 'INVALID_DIRECTORY');
  }
  
  return normalizedPath;
}

// ==================== INPUT VALIDATION ====================

/**
 * Sanitize FTS5 search query to prevent injection
 */
export function sanitizeFtsQuery(query: string): string {
  if (!query || typeof query !== 'string') {
    throw new SecurityError('Invalid search query', 'INVALID_INPUT');
  }
  
  // Remove FTS5 special syntax characters
  // Allowed: alphanumeric, spaces, common punctuation
  const sanitized = query
    .replace(/[*"():^{}[\]\\]/g, ' ')  // Remove FTS operators
    .replace(/\s+/g, ' ')               // Normalize whitespace
    .trim()
    .slice(0, 500);                     // Limit length
  
  if (!sanitized) {
    throw new SecurityError('Search query is empty after sanitization', 'INVALID_INPUT');
  }
  
  return sanitized;
}

/**
 * Validate and sanitize string input
 */
export function sanitizeString(input: unknown, maxLength = 10000): string {
  if (input === null || input === undefined) {
    return '';
  }
  
  if (typeof input !== 'string') {
    throw new SecurityError('Expected string input', 'INVALID_TYPE');
  }
  
  // Truncate if too long
  return input.slice(0, maxLength);
}

/**
 * Validate integer input
 */
export function validateInt(input: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const num = Number(input);
  
  if (!Number.isInteger(num)) {
    throw new SecurityError('Expected integer input', 'INVALID_TYPE');
  }
  
  if (num < min || num > max) {
    throw new SecurityError(`Integer out of range [${min}, ${max}]`, 'OUT_OF_RANGE');
  }
  
  return num;
}

/**
 * Validate enum value
 */
export function validateEnum<T extends string>(
  input: unknown, 
  allowed: readonly T[], 
  defaultValue?: T
): T {
  if (input === undefined && defaultValue !== undefined) {
    return defaultValue;
  }
  
  if (typeof input !== 'string' || !allowed.includes(input as T)) {
    throw new SecurityError(
      `Invalid value. Allowed: ${allowed.join(', ')}`,
      'INVALID_ENUM'
    );
  }
  
  return input as T;
}

// ==================== HTTP SECURITY ====================

/**
 * Validate API key authentication
 */
export function validateApiKey(authHeader: string | undefined, expectedHash: string): boolean {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  
  const token = authHeader.slice(7);
  if (!token || token.length < 32) {
    return false;
  }
  
  // Constant-time comparison
  return constantTimeCompare(hashToken(token), expectedHash);
}

/**
 * Hash a token for storage/comparison
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * Constant-time string comparison to prevent timing attacks
 */
export function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    return false;
  }
  
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  
  return result === 0;
}

// ==================== RATE LIMITING ====================

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Check rate limit for a given key (IP, API key, etc.)
 */
export function checkRateLimit(
  key: string, 
  maxRequests = 100, 
  windowMs = 60000
): { allowed: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  let entry = rateLimitStore.get(key);
  
  // Clean up expired entries periodically
  if (rateLimitStore.size > 10000) {
    for (const [k, v] of rateLimitStore) {
      if (v.resetAt < now) {
        rateLimitStore.delete(k);
      }
    }
  }
  
  if (!entry || entry.resetAt < now) {
    entry = { count: 0, resetAt: now + windowMs };
    rateLimitStore.set(key, entry);
  }
  
  entry.count++;
  
  return {
    allowed: entry.count <= maxRequests,
    remaining: Math.max(0, maxRequests - entry.count),
    resetAt: entry.resetAt
  };
}

// ==================== SECURITY ERROR ====================

export class SecurityError extends Error {
  code: string;
  
  constructor(message: string, code: string) {
    super(message);
    this.name = 'SecurityError';
    this.code = code;
  }
}

// ==================== REQUEST VALIDATION ====================

export const MAX_REQUEST_SIZE = 1024 * 1024; // 1MB
export const MAX_BATCH_SIZE = 1000;
export const MAX_QUERY_RESULTS = 1000;

/**
 * Validate batch operation size
 */
export function validateBatchSize(items: unknown[]): void {
  if (!Array.isArray(items)) {
    throw new SecurityError('Expected array for batch operation', 'INVALID_TYPE');
  }
  
  if (items.length > MAX_BATCH_SIZE) {
    throw new SecurityError(
      `Batch size ${items.length} exceeds maximum of ${MAX_BATCH_SIZE}`,
      'BATCH_TOO_LARGE'
    );
  }
}
