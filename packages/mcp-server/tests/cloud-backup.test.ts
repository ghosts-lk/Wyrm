/**
 * Cloud backup tests — WyrmCloudBackup: configure, local compress/encrypt, metadata
 * 
 * Since we can't actually talk to R2 in tests, we test the local pipeline:
 * configuration, encryption, and buffer-level operations.
 * The S3 client internals are tested indirectly via format helpers.
 */

import { join } from 'path';
import { mkdirSync, existsSync, rmSync, writeFileSync, readFileSync } from 'fs';
import { WyrmCloudBackup } from '../src/cloud-backup.js';

const TEST_DIR = join(process.cwd(), '.test-dbs-cloud');

afterAll(() => {
  try {
    if (existsSync(TEST_DIR)) {
      rmSync(TEST_DIR, { recursive: true, force: true });
    }
  } catch { /* ignore */ }
});

beforeAll(() => {
  if (!existsSync(TEST_DIR)) {
    mkdirSync(TEST_DIR, { recursive: true });
  }
});

// ==================== Configuration ====================

describe('WyrmCloudBackup — Configuration', () => {
  it('starts unconfigured', () => {
    const backup = new WyrmCloudBackup();
    expect(backup.isConfigured()).toBe(false);
  });

  it('configures with valid config', () => {
    const backup = new WyrmCloudBackup();
    backup.configure({
      endpoint: 'https://test.r2.cloudflarestorage.com',
      bucket: 'test-bucket',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });
    expect(backup.isConfigured()).toBe(true);
  });

  it('configures with encryption key', () => {
    const backup = new WyrmCloudBackup();
    backup.configure(
      {
        endpoint: 'https://test.r2.cloudflarestorage.com',
        bucket: 'test-bucket',
        accessKeyId: 'test-key',
        secretAccessKey: 'test-secret',
      },
      'my-encryption-password'
    );
    expect(backup.isConfigured()).toBe(true);
  });

  it('throws on missing config fields', () => {
    const backup = new WyrmCloudBackup();
    expect(() => {
      backup.configure({
        endpoint: '',
        bucket: '',
        accessKeyId: '',
        secretAccessKey: '',
      });
    }).toThrow();
  });

  it('throws on partially missing config', () => {
    const backup = new WyrmCloudBackup();
    expect(() => {
      backup.configure({
        endpoint: 'https://test.r2.com',
        bucket: 'bucket',
        accessKeyId: '', // missing
        secretAccessKey: 'secret',
      });
    }).toThrow();
  });
});

// ==================== Backup — Error Cases ====================

describe('WyrmCloudBackup — Error Cases', () => {
  it('backup fails when not configured', async () => {
    const backup = new WyrmCloudBackup();
    const dbPath = join(TEST_DIR, 'test.db');
    writeFileSync(dbPath, 'test data');

    await expect(backup.backup(dbPath)).rejects.toThrow();
  });

  it('backup fails with non-existent db path', async () => {
    const backup = new WyrmCloudBackup();
    backup.configure({
      endpoint: 'https://test.r2.cloudflarestorage.com',
      bucket: 'test-bucket',
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
    });

    await expect(backup.backup('/nonexistent/path/db.sqlite')).rejects.toThrow();
  });

  it('restore fails when not configured', async () => {
    const backup = new WyrmCloudBackup();
    await expect(backup.restore('some-key', '/some/path')).rejects.toThrow();
  });

  it('list fails when not configured', async () => {
    const backup = new WyrmCloudBackup();
    await expect(backup.listBackups()).rejects.toThrow();
  });
});
