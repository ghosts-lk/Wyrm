/**
 * Crypto module tests — WyrmCrypto: encrypt, decrypt, maybeEncrypt, maybeDecrypt, hash, token
 */

import { WyrmCrypto, getCrypto, initializeCrypto } from '../src/crypto.js';

// ==================== WyrmCrypto Class ====================

describe('WyrmCrypto — Initialization', () => {
  it('creates disabled by default', () => {
    const crypto = new WyrmCrypto();
    expect(crypto.isEnabled()).toBe(false);
  });

  it('enables with a valid password', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('superSecureP@ssword');
    expect(crypto.isEnabled()).toBe(true);
  });

  it('throws on short password', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    expect(() => crypto.initialize('short')).toThrow('at least 8 characters');
  });

  it('throws on empty password', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    expect(() => crypto.initialize('')).toThrow();
  });
});

describe('WyrmCrypto — Encrypt / Decrypt', () => {
  let crypto: WyrmCrypto;

  beforeEach(() => {
    crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('test-password-123');
  });

  it('encrypts and decrypts a simple string', () => {
    const plaintext = 'Hello, Wyrm!';
    const encrypted = crypto.encrypt(plaintext);

    expect(encrypted.iv).toBeDefined();
    expect(encrypted.salt).toBeDefined();
    expect(encrypted.tag).toBeDefined();
    expect(encrypted.data).toBeDefined();
    expect(encrypted.version).toBe(1);
    expect(encrypted.data).not.toBe(plaintext);

    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts empty string', () => {
    const encrypted = crypto.encrypt('');
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe('');
  });

  it('encrypts and decrypts long text', () => {
    const plaintext = 'A'.repeat(100000);
    const encrypted = crypto.encrypt(plaintext);
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts Unicode text', () => {
    const plaintext = '🐉 Wyrm — ドラゴン — التنين — 龙';
    const encrypted = crypto.encrypt(plaintext);
    const decrypted = crypto.decrypt(encrypted);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypts and decrypts JSON strings', () => {
    const data = JSON.stringify({ key: 'value', nested: { arr: [1, 2, 3] } });
    const encrypted = crypto.encrypt(data);
    const decrypted = crypto.decrypt(encrypted);
    expect(JSON.parse(decrypted)).toEqual(JSON.parse(data));
  });

  it('produces different ciphertexts for same plaintext', () => {
    const plaintext = 'same text';
    const e1 = crypto.encrypt(plaintext);
    const e2 = crypto.encrypt(plaintext);
    // Different IVs/salts mean different output
    expect(e1.iv).not.toBe(e2.iv);
    expect(e1.data).not.toBe(e2.data);
  });

  it('fails to decrypt with wrong password', () => {
    const encrypted = crypto.encrypt('secret data');

    const other = new WyrmCrypto({ enabled: true });
    other.initialize('wrong-password-xyz');

    expect(() => other.decrypt(encrypted)).toThrow();
  });

  it('throws when not enabled', () => {
    const disabled = new WyrmCrypto();
    expect(() => disabled.encrypt('test')).toThrow('not enabled');
    expect(() => disabled.decrypt({ iv: '', salt: '', tag: '', data: '', version: 1 })).toThrow('not enabled');
  });
});

describe('WyrmCrypto — maybeEncrypt / maybeDecrypt', () => {
  it('returns plaintext when encryption is disabled', () => {
    const crypto = new WyrmCrypto();
    expect(crypto.maybeEncrypt('hello')).toBe('hello');
    expect(crypto.maybeDecrypt('hello')).toBe('hello');
  });

  it('encrypts with ENC: prefix when enabled', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('password12345');

    const result = crypto.maybeEncrypt('secret');
    expect(result).toMatch(/^ENC:/);
  });

  it('round-trips through maybeEncrypt/maybeDecrypt', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('password12345');

    const encrypted = crypto.maybeEncrypt('dragon hoard');
    const decrypted = crypto.maybeDecrypt(encrypted);
    expect(decrypted).toBe('dragon hoard');
  });

  it('handles non-encrypted strings in maybeDecrypt', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('password12345');

    // Not prefixed with ENC: — returned as-is
    expect(crypto.maybeDecrypt('plain text')).toBe('plain text');
  });

  it('returns placeholder when decryption fails', () => {
    const crypto = new WyrmCrypto({ enabled: true });
    crypto.initialize('password12345');

    expect(crypto.maybeDecrypt('ENC:invalid-json')).toBe('[DECRYPT FAILED]');
  });

  it('returns placeholder when key is not available', () => {
    const crypto = new WyrmCrypto(); // disabled
    expect(crypto.maybeDecrypt('ENC:{"iv":"aa","salt":"bb","tag":"cc","data":"dd","version":1}')).toBe('[ENCRYPTED - KEY REQUIRED]');
  });
});

describe('WyrmCrypto — Static Utilities', () => {
  it('generates secure tokens', () => {
    const token1 = WyrmCrypto.generateSecureToken();
    const token2 = WyrmCrypto.generateSecureToken();
    expect(token1.length).toBe(64); // 32 bytes = 64 hex chars
    expect(token1).not.toBe(token2);
  });

  it('generates tokens of custom length', () => {
    const token = WyrmCrypto.generateSecureToken(16);
    expect(token.length).toBe(32); // 16 bytes = 32 hex chars
  });

  it('hashes a value', () => {
    const hash = WyrmCrypto.hash('hello');
    expect(hash).toHaveLength(64); // SHA-256 = 64 hex chars
  });

  it('produces consistent hashes', () => {
    const h1 = WyrmCrypto.hash('test');
    const h2 = WyrmCrypto.hash('test');
    expect(h1).toBe(h2);
  });

  it('verifies correct hash', () => {
    const hash = WyrmCrypto.hash('hello');
    expect(WyrmCrypto.verifyHash('hello', hash)).toBe(true);
  });

  it('rejects wrong hash', () => {
    const hash = WyrmCrypto.hash('hello');
    expect(WyrmCrypto.verifyHash('world', hash)).toBe(false);
  });

  it('supports different hash algorithms', () => {
    const sha512 = WyrmCrypto.hash('test', 'sha512');
    expect(sha512.length).toBe(128); // SHA-512 = 128 hex chars
  });
});

// ==================== Singleton Functions ====================

describe('Crypto Singleton (getCrypto, initializeCrypto)', () => {
  it('getCrypto returns a disabled instance by default', () => {
    const c = getCrypto();
    expect(c).toBeDefined();
    expect(c.isEnabled()).toBe(false);
  });

  it('initializeCrypto creates an enabled instance', () => {
    const c = initializeCrypto('testPassword123!');
    expect(c.isEnabled()).toBe(true);
  });
});
