/**
 * Security module tests — input sanitization, validation, and path security
 */

import {
  sanitizeFtsQuery,
  sanitizeString,
  validateInt,
  validateEnum,
  validatePath,
  validateBatchSize,
  checkRateLimit,
  hashToken,
  constantTimeCompare,
  validateApiKey,
  SecurityError,
  MAX_BATCH_SIZE,
  MAX_REQUEST_SIZE,
  MAX_QUERY_RESULTS,
} from '../src/security.js';

// ==================== sanitizeFtsQuery ====================

describe('sanitizeFtsQuery', () => {
  it('passes through normal text', () => {
    expect(sanitizeFtsQuery('hello world')).toBe('hello world');
  });

  it('strips FTS5 operators', () => {
    const result = sanitizeFtsQuery('hello* AND "exact" OR (group)');
    // All special chars replaced with spaces, then collapsed
    expect(result).not.toContain('*');
    expect(result).not.toContain('"');
    expect(result).not.toContain('(');
    expect(result).not.toContain(')');
  });

  it('normalizes whitespace', () => {
    expect(sanitizeFtsQuery('  hello   world  ')).toBe('hello world');
  });

  it('truncates to 500 characters', () => {
    const longQuery = 'a'.repeat(600);
    expect(sanitizeFtsQuery(longQuery).length).toBeLessThanOrEqual(500);
  });

  it('throws on null/undefined input', () => {
    expect(() => sanitizeFtsQuery(null as unknown as string)).toThrow(SecurityError);
    expect(() => sanitizeFtsQuery(undefined as unknown as string)).toThrow(SecurityError);
  });

  it('throws on empty string', () => {
    expect(() => sanitizeFtsQuery('')).toThrow(SecurityError);
  });

  it('throws when all content is stripped', () => {
    expect(() => sanitizeFtsQuery('***""()()')).toThrow(SecurityError);
  });
});

// ==================== sanitizeString ====================

describe('sanitizeString', () => {
  it('returns string as-is when under max length', () => {
    expect(sanitizeString('hello')).toBe('hello');
  });

  it('truncates to maxLength', () => {
    expect(sanitizeString('hello world', 5)).toBe('hello');
  });

  it('returns empty string for null', () => {
    expect(sanitizeString(null)).toBe('');
  });

  it('returns empty string for undefined', () => {
    expect(sanitizeString(undefined)).toBe('');
  });

  it('throws for non-string types', () => {
    expect(() => sanitizeString(42)).toThrow(SecurityError);
    expect(() => sanitizeString({})).toThrow(SecurityError);
    expect(() => sanitizeString(true)).toThrow(SecurityError);
  });
});

// ==================== validateInt ====================

describe('validateInt', () => {
  it('accepts valid integers', () => {
    expect(validateInt(42)).toBe(42);
    expect(validateInt(0)).toBe(0);
    expect(validateInt('100')).toBe(100);
  });

  it('respects min/max range', () => {
    expect(validateInt(5, 1, 10)).toBe(5);
  });

  it('throws on out of range', () => {
    expect(() => validateInt(0, 1, 10)).toThrow(SecurityError);
    expect(() => validateInt(11, 1, 10)).toThrow(SecurityError);
  });

  it('throws on non-integer', () => {
    expect(() => validateInt('abc')).toThrow(SecurityError);
    expect(() => validateInt(3.14)).toThrow(SecurityError);
  });

  it('coerces null to 0', () => {
    // Number(null) === 0 which is a valid integer
    expect(validateInt(null)).toBe(0);
  });
});

// ==================== validateEnum ====================

describe('validateEnum', () => {
  const allowed = ['low', 'medium', 'high'] as const;

  it('accepts valid enum values', () => {
    expect(validateEnum('low', allowed)).toBe('low');
    expect(validateEnum('high', allowed)).toBe('high');
  });

  it('returns default for undefined input', () => {
    expect(validateEnum(undefined, allowed, 'medium')).toBe('medium');
  });

  it('throws for invalid value', () => {
    expect(() => validateEnum('critical', allowed)).toThrow(SecurityError);
    expect(() => validateEnum(42, allowed)).toThrow(SecurityError);
  });
});

// ==================== validatePath ====================

describe('validatePath', () => {
  it('accepts valid paths within base', () => {
    const result = validatePath('/home/test', 'subdir/file.txt');
    expect(result).toContain('subdir/file.txt');
  });

  it('rejects directory traversal', () => {
    expect(() => validatePath('/home/test', '../../etc/passwd')).toThrow(SecurityError);
    expect(() => validatePath('/home/test', '../sibling')).toThrow(SecurityError);
  });

  it('handles absolute paths within base', () => {
    const result = validatePath('/home/test', '/home/test/file.txt');
    expect(result).toContain('file.txt');
  });
});

// ==================== validateBatchSize ====================

describe('validateBatchSize', () => {
  it('accepts arrays within limit', () => {
    expect(() => validateBatchSize([1, 2, 3])).not.toThrow();
    expect(() => validateBatchSize([])).not.toThrow();
  });

  it('throws for non-array', () => {
    expect(() => validateBatchSize('not array' as unknown as unknown[])).toThrow(SecurityError);
  });

  it('throws for oversized batch', () => {
    const large = new Array(MAX_BATCH_SIZE + 1).fill(0);
    expect(() => validateBatchSize(large)).toThrow(SecurityError);
  });

  it('accepts exactly MAX_BATCH_SIZE', () => {
    const exact = new Array(MAX_BATCH_SIZE).fill(0);
    expect(() => validateBatchSize(exact)).not.toThrow();
  });
});

// ==================== hashToken & constantTimeCompare ====================

describe('hashToken', () => {
  it('produces consistent SHA256 hashes', () => {
    const hash1 = hashToken('test-token');
    const hash2 = hashToken('test-token');
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA256 hex
  });

  it('produces different hashes for different tokens', () => {
    expect(hashToken('token-a')).not.toBe(hashToken('token-b'));
  });
});

describe('constantTimeCompare', () => {
  it('returns true for equal strings', () => {
    expect(constantTimeCompare('abc', 'abc')).toBe(true);
  });

  it('returns false for different strings', () => {
    expect(constantTimeCompare('abc', 'xyz')).toBe(false);
  });

  it('returns false for different lengths', () => {
    expect(constantTimeCompare('short', 'longer')).toBe(false);
  });
});

// ==================== validateApiKey ====================

describe('validateApiKey', () => {
  it('validates correct bearer token', () => {
    const token = 'a'.repeat(64);
    const hash = hashToken(token);
    expect(validateApiKey(`Bearer ${token}`, hash)).toBe(true);
  });

  it('rejects missing header', () => {
    expect(validateApiKey(undefined, 'hash')).toBe(false);
  });

  it('rejects non-bearer scheme', () => {
    expect(validateApiKey('Basic abc123', 'hash')).toBe(false);
  });

  it('rejects short tokens', () => {
    expect(validateApiKey('Bearer short', 'hash')).toBe(false);
  });

  it('rejects wrong token', () => {
    const hash = hashToken('a'.repeat(64));
    expect(validateApiKey(`Bearer ${'b'.repeat(64)}`, hash)).toBe(false);
  });
});

// ==================== checkRateLimit ====================

describe('checkRateLimit', () => {
  it('allows requests within limit', () => {
    const key = `test-${Date.now()}-${Math.random()}`;
    const result = checkRateLimit(key, 10, 60000);
    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(9);
  });

  it('blocks when limit exceeded', () => {
    const key = `test-exceed-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < 5; i++) {
      checkRateLimit(key, 5, 60000);
    }
    const result = checkRateLimit(key, 5, 60000);
    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

// ==================== SecurityError ====================

describe('SecurityError', () => {
  it('has correct name and code', () => {
    const err = new SecurityError('test message', 'TEST_CODE');
    expect(err.name).toBe('SecurityError');
    expect(err.code).toBe('TEST_CODE');
    expect(err.message).toBe('test message');
    expect(err).toBeInstanceOf(Error);
  });
});

// ==================== Constants ====================

describe('security constants', () => {
  it('has expected values', () => {
    expect(MAX_REQUEST_SIZE).toBe(1024 * 1024);
    expect(MAX_BATCH_SIZE).toBe(1000);
    expect(MAX_QUERY_RESULTS).toBe(1000);
  });
});
