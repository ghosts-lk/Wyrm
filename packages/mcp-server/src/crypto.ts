/**
 * Wyrm Encryption Module
 * AES-256-GCM encryption for sensitive memory data
 * 
 * @module crypto
 * @version 3.0.0
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;

export interface EncryptedData {
  iv: string;
  salt: string;
  tag: string;
  data: string;
  version: number;
}

export interface CryptoConfig {
  enabled: boolean;
  keyDerivation: 'scrypt' | 'pbkdf2';
  iterations?: number;
}

/**
 * Wyrm Crypto - Handles encryption/decryption of sensitive data
 */
export class WyrmCrypto {
  private masterKey: Buffer | null = null;
  private config: CryptoConfig;

  constructor(config?: Partial<CryptoConfig>) {
    this.config = {
      enabled: config?.enabled ?? false,
      keyDerivation: config?.keyDerivation ?? 'scrypt',
      iterations: config?.iterations ?? 100000,
    };
  }

  /**
   * Initialize crypto with a master password
   */
  initialize(password: string): void {
    if (!password || password.length < 8) {
      throw new Error('Password must be at least 8 characters');
    }
    
    // Create a consistent master key from password
    const salt = createHash('sha256').update('wyrm-master-salt').digest();
    this.masterKey = scryptSync(password, salt, KEY_LENGTH);
    this.config.enabled = true;
  }

  /**
   * Check if encryption is enabled and configured
   */
  isEnabled(): boolean {
    return this.config.enabled && this.masterKey !== null;
  }

  /**
   * Derive a unique key for each piece of data
   */
  private deriveKey(salt: Buffer): Buffer {
    if (!this.masterKey) {
      throw new Error('Crypto not initialized. Call initialize() with a password first.');
    }
    return scryptSync(this.masterKey, salt, KEY_LENGTH);
  }

  /**
   * Encrypt a string value
   */
  encrypt(plaintext: string): EncryptedData {
    if (!this.isEnabled()) {
      throw new Error('Encryption not enabled');
    }

    const salt = randomBytes(SALT_LENGTH);
    const iv = randomBytes(IV_LENGTH);
    const key = this.deriveKey(salt);

    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(plaintext, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const tag = cipher.getAuthTag();

    return {
      iv: iv.toString('hex'),
      salt: salt.toString('hex'),
      tag: tag.toString('hex'),
      data: encrypted,
      version: 1,
    };
  }

  /**
   * Decrypt an encrypted value
   */
  decrypt(encrypted: EncryptedData): string {
    if (!this.isEnabled()) {
      throw new Error('Encryption not enabled');
    }

    const salt = Buffer.from(encrypted.salt, 'hex');
    const iv = Buffer.from(encrypted.iv, 'hex');
    const tag = Buffer.from(encrypted.tag, 'hex');
    const key = this.deriveKey(salt);

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);

    let decrypted = decipher.update(encrypted.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Encrypt if enabled, otherwise return plaintext
   */
  maybeEncrypt(value: string): string {
    if (!this.isEnabled()) {
      return value;
    }
    const encrypted = this.encrypt(value);
    return `ENC:${JSON.stringify(encrypted)}`;
  }

  /**
   * Decrypt if encrypted, otherwise return as-is
   */
  maybeDecrypt(value: string): string {
    if (!value.startsWith('ENC:')) {
      return value;
    }
    if (!this.isEnabled()) {
      // Can't decrypt without key
      return '[ENCRYPTED - KEY REQUIRED]';
    }
    try {
      const encrypted = JSON.parse(value.slice(4)) as EncryptedData;
      return this.decrypt(encrypted);
    } catch {
      return '[DECRYPT FAILED]';
    }
  }

  /**
   * Generate a secure random key for API tokens, etc.
   */
  static generateSecureToken(length = 32): string {
    return randomBytes(length).toString('hex');
  }

  /**
   * Hash a value for comparison (one-way)
   */
  static hash(value: string, algorithm = 'sha256'): string {
    return createHash(algorithm).update(value).digest('hex');
  }

  /**
   * Verify a hash
   */
  static verifyHash(value: string, hash: string, algorithm = 'sha256'): boolean {
    const computed = WyrmCrypto.hash(value, algorithm);
    // Constant-time comparison
    if (computed.length !== hash.length) return false;
    let result = 0;
    for (let i = 0; i < computed.length; i++) {
      result |= computed.charCodeAt(i) ^ hash.charCodeAt(i);
    }
    return result === 0;
  }
}

// Singleton instance
let cryptoInstance: WyrmCrypto | null = null;

export function getCrypto(): WyrmCrypto {
  if (!cryptoInstance) {
    cryptoInstance = new WyrmCrypto();
  }
  return cryptoInstance;
}

export function initializeCrypto(password: string): WyrmCrypto {
  cryptoInstance = new WyrmCrypto({ enabled: true });
  cryptoInstance.initialize(password);
  return cryptoInstance;
}
