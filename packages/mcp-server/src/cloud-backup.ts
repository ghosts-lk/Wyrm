/**
 * Wyrm Cloud Backup — Encrypted backup/restore to Cloudflare R2
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module cloud-backup
 * @version 3.2.0
 */

import { createReadStream, createWriteStream, statSync, existsSync, copyFileSync, unlinkSync, readFileSync, writeFileSync, renameSync } from 'fs';
import { createGzip, createGunzip, gzipSync, gunzipSync } from 'zlib';
import { pipeline } from 'stream/promises';
import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash, createHmac } from 'crypto';
import { join } from 'path';
import { tmpdir } from 'os';
import { hostname, platform, arch, cpus } from 'os';

// ==================== TYPES ====================

export interface CloudConfig {
  endpoint: string;         // R2 endpoint: https://<account-id>.r2.cloudflarestorage.com
  bucket: string;           // "wyrm-backups"
  accessKeyId: string;      // R2 access key
  secretAccessKey: string;  // R2 secret
  region?: string;          // "auto" for R2
}

export interface BackupMetadata {
  version: number;          // backup format version (1)
  wyrm_version: string;     // "3.2.0"
  timestamp: string;        // ISO date
  db_size: number;          // original size in bytes
  compressed_size: number;  // after gzip
  encrypted: boolean;
  machine_id: string;       // for device tracking
  checksum: string;         // SHA-256 of encrypted blob
}

interface S3ListObject {
  key: string;
  size: number;
  lastModified: string;
}

// ==================== CONSTANTS ====================

const WYRM_VERSION = '3.2.0';
const BACKUP_FORMAT_VERSION = 1;
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const SALT_LENGTH = 32;
const TAG_LENGTH = 16;
const KEY_LENGTH = 32;
const DEFAULT_KEEP_COUNT = 10;

// ==================== BUFFER ENCRYPTION ====================

/**
 * Encrypt a buffer with AES-256-GCM using a password.
 * Output format: [16-byte IV][32-byte salt][16-byte auth tag][encrypted data]
 */
function encryptBuffer(data: Buffer, password: string): Buffer {
  const iv = randomBytes(IV_LENGTH);
  const salt = randomBytes(SALT_LENGTH);
  const key = scryptSync(password, salt, KEY_LENGTH);

  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();

  // Header: IV + salt + auth tag + ciphertext
  return Buffer.concat([iv, salt, tag, encrypted]);
}

/**
 * Decrypt a buffer encrypted by encryptBuffer.
 * Parses the [IV][salt][tag][data] header, derives key, decrypts.
 */
function decryptBuffer(encrypted: Buffer, password: string): Buffer {
  const headerSize = IV_LENGTH + SALT_LENGTH + TAG_LENGTH;
  if (encrypted.length < headerSize) {
    throw new Error('Encrypted data too short — corrupted or not a Wyrm backup');
  }

  let offset = 0;
  const iv = encrypted.subarray(offset, offset += IV_LENGTH);
  const salt = encrypted.subarray(offset, offset += SALT_LENGTH);
  const tag = encrypted.subarray(offset, offset += TAG_LENGTH);
  const data = encrypted.subarray(offset);

  const key = scryptSync(password, salt, KEY_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  try {
    return Buffer.concat([decipher.update(data), decipher.final()]);
  } catch {
    throw new Error('Decryption failed — wrong password or corrupted backup');
  }
}

// ==================== MINIMAL S3-COMPATIBLE CLIENT ====================

/**
 * Minimal S3-compatible client for Cloudflare R2.
 * Uses AWS Signature V4 signing with Node.js built-ins only — zero dependencies.
 */
class S3Client {
  private accessKeyId: string;
  private secretAccessKey: string;
  private region: string;
  private endpoint: string;
  private bucket: string;
  private host: string;

  constructor(config: CloudConfig) {
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.region = config.region ?? 'auto';
    this.endpoint = config.endpoint.replace(/\/$/, '');
    this.bucket = config.bucket;

    // Extract host from endpoint
    const url = new URL(this.endpoint);
    this.host = url.host;
  }

  /** PUT an object to the bucket */
  async putObject(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<void> {
    const path = `/${this.bucket}/${encodeS3Key(key)}`;
    const headers: Record<string, string> = {
      'Content-Type': contentType,
      'Content-Length': body.length.toString(),
    };

    const signed = this.signRequest('PUT', path, headers, body);
    const res = await fetch(`${this.endpoint}${path}`, {
      method: 'PUT',
      headers: signed,
      body: body as never,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S3 PUT failed (${res.status}): ${text}`);
    }
  }

  /** GET an object from the bucket */
  async getObject(key: string): Promise<Buffer> {
    const path = `/${this.bucket}/${encodeS3Key(key)}`;
    const headers: Record<string, string> = {};

    const signed = this.signRequest('GET', path, headers);
    const res = await fetch(`${this.endpoint}${path}`, {
      method: 'GET',
      headers: signed,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S3 GET failed (${res.status}): ${text}`);
    }

    const arrayBuf = await res.arrayBuffer();
    return Buffer.from(arrayBuf);
  }

  /** LIST objects with a given prefix */
  async listObjects(prefix: string): Promise<S3ListObject[]> {
    const results: S3ListObject[] = [];
    let continuationToken: string | undefined;

    do {
      const params = new URLSearchParams({
        'list-type': '2',
        prefix,
      });
      if (continuationToken) {
        params.set('continuation-token', continuationToken);
      }

      const path = `/${this.bucket}?${params.toString()}`;
      const headers: Record<string, string> = {};

      const signed = this.signRequest('GET', path, headers);
      const res = await fetch(`${this.endpoint}${path}`, {
        method: 'GET',
        headers: signed,
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`S3 LIST failed (${res.status}): ${text}`);
      }

      const xml = await res.text();
      results.push(...parseListXml(xml));

      // Check for truncation / pagination
      const truncatedMatch = xml.match(/<IsTruncated>(.*?)<\/IsTruncated>/);
      const isTruncated = truncatedMatch?.[1] === 'true';

      if (isTruncated) {
        const tokenMatch = xml.match(/<NextContinuationToken>(.*?)<\/NextContinuationToken>/);
        continuationToken = tokenMatch?.[1];
      } else {
        continuationToken = undefined;
      }
    } while (continuationToken);

    return results;
  }

  /** DELETE an object from the bucket */
  async deleteObject(key: string): Promise<void> {
    const path = `/${this.bucket}/${encodeS3Key(key)}`;
    const headers: Record<string, string> = {};

    const signed = this.signRequest('DELETE', path, headers);
    const res = await fetch(`${this.endpoint}${path}`, {
      method: 'DELETE',
      headers: signed,
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`S3 DELETE failed (${res.status}): ${text}`);
    }
  }

  /**
   * Generate AWS Signature V4 headers.
   * Implements the full signing flow:
   *   1. Canonical request
   *   2. String to sign
   *   3. Signing key derivation
   *   4. Authorization header
   */
  private signRequest(
    method: string,
    path: string,
    headers: Record<string, string>,
    body?: Buffer,
  ): Record<string, string> {
    const now = new Date();
    const dateStamp = toDateStamp(now);   // YYYYMMDD
    const amzDate = toAmzDate(now);       // YYYYMMDD'T'HHMMSS'Z'

    // Split path and query string
    const [canonicalUri, queryString] = splitPathQuery(path);

    // Required headers
    headers['host'] = this.host;
    headers['x-amz-date'] = amzDate;
    headers['x-amz-content-sha256'] = sha256Hex(body ?? Buffer.alloc(0));

    // 1. Canonical request
    const signedHeaderKeys = Object.keys(headers)
      .map(k => k.toLowerCase())
      .sort();

    const canonicalHeaders = signedHeaderKeys
      .map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)!]!.trim()}`)
      .join('\n') + '\n';

    const signedHeaders = signedHeaderKeys.join(';');

    const canonicalRequest = [
      method,
      canonicalUri,
      normalizeQueryString(queryString),
      canonicalHeaders,
      signedHeaders,
      headers['x-amz-content-sha256'],
    ].join('\n');

    // 2. String to sign
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      sha256Hex(Buffer.from(canonicalRequest, 'utf-8')),
    ].join('\n');

    // 3. Signing key
    const signingKey = deriveSigningKey(this.secretAccessKey, dateStamp, this.region, 's3');

    // 4. Signature
    const signature = hmacHex(signingKey, stringToSign);

    // 5. Authorization header
    headers['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${this.accessKeyId}/${credentialScope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return headers;
  }
}

// ==================== S3 SIGNING HELPERS ====================

function toDateStamp(date: Date): string {
  return date.toISOString().replace(/[-:T]/g, '').slice(0, 8);
}

function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

function hmac(key: Buffer | string, data: string): Buffer {
  return createHmac('sha256', key).update(data, 'utf-8').digest();
}

function hmacHex(key: Buffer | string, data: string): string {
  return createHmac('sha256', key).update(data, 'utf-8').digest('hex');
}

function deriveSigningKey(secret: string, dateStamp: string, region: string, service: string): Buffer {
  let key: Buffer = hmac(`AWS4${secret}`, dateStamp);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, 'aws4_request');
  return key;
}

/**
 * Encode an S3 key — URI-encode each path segment individually,
 * preserving `/` separators.
 */
function encodeS3Key(key: string): string {
  return key
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

/**
 * Split a path into canonical URI and query string.
 * e.g. "/bucket?list-type=2&prefix=x" → ["/bucket", "list-type=2&prefix=x"]
 */
function splitPathQuery(path: string): [string, string] {
  const idx = path.indexOf('?');
  if (idx === -1) return [path, ''];
  return [path.slice(0, idx), path.slice(idx + 1)];
}

/**
 * Normalize a query string for canonical request:
 * sort by parameter name, then by value.
 */
function normalizeQueryString(qs: string): string {
  if (!qs) return '';
  return qs
    .split('&')
    .map(pair => {
      const [k, v] = pair.split('=');
      return `${encodeURIComponent(decodeURIComponent(k!))}=${encodeURIComponent(decodeURIComponent(v ?? ''))}`;
    })
    .sort()
    .join('&');
}

/**
 * Parse the XML response from S3 ListObjectsV2.
 * Extracts <Key>, <Size>, <LastModified> from each <Contents> block.
 */
function parseListXml(xml: string): S3ListObject[] {
  const results: S3ListObject[] = [];
  const contentsRegex = /<Contents>([\s\S]*?)<\/Contents>/g;
  let match: RegExpExecArray | null;

  while ((match = contentsRegex.exec(xml)) !== null) {
    const block = match[1]!;
    const key = block.match(/<Key>(.*?)<\/Key>/)?.[1] ?? '';
    const size = parseInt(block.match(/<Size>(.*?)<\/Size>/)?.[1] ?? '0', 10);
    const lastModified = block.match(/<LastModified>(.*?)<\/LastModified>/)?.[1] ?? '';
    results.push({ key, size, lastModified });
  }

  return results;
}

// ==================== WYRM CLOUD BACKUP ====================

export class WyrmCloudBackup {
  private config: CloudConfig | null = null;
  private encryptionKey: string | null = null;
  private s3: S3Client | null = null;

  constructor() {}

  /** Configure cloud storage credentials and optional encryption key */
  configure(config: CloudConfig, encryptionKey?: string): void {
    if (!config.endpoint || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
      throw new Error('Cloud config requires endpoint, bucket, accessKeyId, and secretAccessKey');
    }

    this.config = {
      ...config,
      region: config.region ?? 'auto',
    };
    this.encryptionKey = encryptionKey ?? null;
    this.s3 = new S3Client(this.config);
  }

  /** Check if cloud backup is configured */
  isConfigured(): boolean {
    return this.config !== null && this.s3 !== null;
  }

  /**
   * Backup: SQLite DB → gzip → AES-256-GCM encrypt → upload to R2
   *
   * Pipeline:
   *   1. Copy SQLite file to a temp snapshot (safe point-in-time copy)
   *   2. Gzip compress
   *   3. If encryption key set: AES-256-GCM encrypt the gzipped blob
   *   4. Upload encrypted/compressed blob to R2
   *   5. Upload metadata JSON alongside
   *   6. Clean up temp files
   *
   * Key format: backups/{machine_id}/{YYYY-MM-DD_HHmmss}.wyrm.bak
   */
  async backup(dbPath: string): Promise<{ key: string; metadata: BackupMetadata }> {
    this.assertConfigured();

    if (!existsSync(dbPath)) {
      throw new Error(`Database not found: ${dbPath}`);
    }

    const dbStat = statSync(dbPath);
    const machineId = this.getMachineId();
    const now = new Date();
    const timestamp = formatTimestamp(now);
    const backupKey = `backups/${machineId}/${timestamp}.wyrm.bak`;
    const metadataKey = `backups/${machineId}/${timestamp}.wyrm.meta.json`;

    // Temp files in the same directory as the DB to avoid cross-device issues
    const dbDir = join(dbPath, '..');
    const tempCopy = join(dbDir, `.wyrm-backup-${Date.now()}.tmp`);
    const tempGz = join(dbDir, `.wyrm-backup-${Date.now()}.gz.tmp`);

    try {
      // 1. Safe snapshot — copy the database file
      copyFileSync(dbPath, tempCopy);

      // Also copy WAL/SHM if they exist (for consistency)
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (existsSync(walPath)) copyFileSync(walPath, `${tempCopy}-wal`);
      if (existsSync(shmPath)) copyFileSync(shmPath, `${tempCopy}-shm`);

      // 2. Gzip compress
      await pipeline(
        createReadStream(tempCopy),
        createGzip({ level: 9 }),
        createWriteStream(tempGz),
      );

      let uploadPayload: Buffer = Buffer.from(readFileSync(tempGz));
      const compressedSize = uploadPayload.length;

      // 3. Encrypt if key is set
      const isEncrypted = this.encryptionKey !== null;
      if (isEncrypted) {
        uploadPayload = encryptBuffer(uploadPayload, this.encryptionKey!);
      }

      // Compute checksum of final payload
      const checksum = sha256Hex(uploadPayload);

      // 4. Upload blob
      await this.s3!.putObject(backupKey, uploadPayload, 'application/x-wyrm-backup');

      // 5. Build and upload metadata
      const metadata: BackupMetadata = {
        version: BACKUP_FORMAT_VERSION,
        wyrm_version: WYRM_VERSION,
        timestamp: now.toISOString(),
        db_size: dbStat.size,
        compressed_size: compressedSize,
        encrypted: isEncrypted,
        machine_id: machineId,
        checksum,
      };

      await this.s3!.putObject(
        metadataKey,
        Buffer.from(JSON.stringify(metadata, null, 2), 'utf-8'),
        'application/json',
      );

      return { key: backupKey, metadata };
    } finally {
      // 6. Clean up temp files
      safeUnlink(tempCopy);
      safeUnlink(tempGz);
      safeUnlink(`${tempCopy}-wal`);
      safeUnlink(`${tempCopy}-shm`);
    }
  }

  /**
   * List available backups for this machine, sorted newest-first.
   * Fetches metadata JSON for each backup.
   */
  async listBackups(): Promise<BackupMetadata[]> {
    this.assertConfigured();

    const machineId = this.getMachineId();
    const prefix = `backups/${machineId}/`;
    const objects = await this.s3!.listObjects(prefix);

    // Find metadata files
    const metaObjects = objects.filter(o => o.key.endsWith('.wyrm.meta.json'));

    const metadataList: BackupMetadata[] = [];
    for (const obj of metaObjects) {
      try {
        const buf = await this.s3!.getObject(obj.key);
        const meta = JSON.parse(buf.toString('utf-8')) as BackupMetadata;
        metadataList.push(meta);
      } catch {
        // Skip unreadable metadata
      }
    }

    // Sort newest first
    metadataList.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return metadataList;
  }

  /**
   * Restore: Download from R2 → decrypt → gunzip → write to target path.
   *
   * If the target file already exists, it is renamed to `{target}.bak` before overwriting.
   * Verifies checksum of the downloaded blob against metadata.
   */
  async restore(backupKey: string, targetPath: string): Promise<{ restored: boolean; size: number }> {
    this.assertConfigured();

    // Derive metadata key from backup key
    const metadataKey = backupKey.replace(/\.wyrm\.bak$/, '.wyrm.meta.json');

    // Download metadata
    let metadata: BackupMetadata;
    try {
      const metaBuf = await this.s3!.getObject(metadataKey);
      metadata = JSON.parse(metaBuf.toString('utf-8')) as BackupMetadata;
    } catch {
      throw new Error(`Backup metadata not found for key: ${backupKey}`);
    }

    // 1. Download encrypted blob
    let blob = await this.s3!.getObject(backupKey);

    // 5. Verify checksum
    const actualChecksum = sha256Hex(blob);
    if (actualChecksum !== metadata.checksum) {
      throw new Error(
        `Checksum mismatch — backup may be corrupted. ` +
        `Expected: ${metadata.checksum}, Got: ${actualChecksum}`,
      );
    }

    // 2. Decrypt if encrypted
    if (metadata.encrypted) {
      if (!this.encryptionKey) {
        throw new Error('Backup is encrypted but no encryption key is configured');
      }
      blob = decryptBuffer(blob, this.encryptionKey);
    }

    // 3. Gunzip decompress
    const decompressed = gunzipSync(blob as unknown as Parameters<typeof gunzipSync>[0]);

    // 4. Write to targetPath (back up existing file first)
    if (existsSync(targetPath)) {
      const bakPath = `${targetPath}.bak`;
      renameSync(targetPath, bakPath);
    }
    writeFileSync(targetPath, decompressed);

    return { restored: true, size: decompressed.length };
  }

  /**
   * Delete old backups, keeping the most recent `keepCount`.
   * Deletes both the .wyrm.bak blob and its .wyrm.meta.json sidecar.
   */
  async pruneBackups(keepCount = DEFAULT_KEEP_COUNT): Promise<{ deleted: number }> {
    this.assertConfigured();

    const machineId = this.getMachineId();
    const prefix = `backups/${machineId}/`;
    const objects = await this.s3!.listObjects(prefix);

    // Pair backup blobs with their metadata by timestamp stem
    const backupBlobs = objects
      .filter(o => o.key.endsWith('.wyrm.bak'))
      .sort((a, b) => b.lastModified.localeCompare(a.lastModified)); // newest first

    if (backupBlobs.length <= keepCount) {
      return { deleted: 0 };
    }

    const toDelete = backupBlobs.slice(keepCount);
    let deleted = 0;

    for (const obj of toDelete) {
      const metaKey = obj.key.replace(/\.wyrm\.bak$/, '.wyrm.meta.json');
      try {
        await this.s3!.deleteObject(obj.key);
        deleted++;
      } catch {
        // Best-effort deletion
      }
      try {
        await this.s3!.deleteObject(metaKey);
      } catch {
        // Metadata may not exist
      }
    }

    return { deleted };
  }

  /**
   * Get a deterministic machine fingerprint for device tracking.
   * Hash of: hostname + platform + arch + first CPU model.
   * Stable across reboots, unique per machine.
   */
  private getMachineId(): string {
    const parts = [
      hostname(),
      platform(),
      arch(),
      cpus()[0]?.model ?? 'unknown-cpu',
    ].join('|');

    return createHash('sha256').update(parts).digest('hex').slice(0, 16);
  }

  /** Throw if not configured */
  private assertConfigured(): void {
    if (!this.isConfigured()) {
      throw new Error(
        'Cloud backup not configured. Call configure() with R2 credentials first.',
      );
    }
  }
}

// ==================== HELPERS ====================

/** Format a Date as YYYY-MM-DD_HHmmss */
function formatTimestamp(date: Date): string {
  const y = date.getUTCFullYear();
  const mo = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const h = String(date.getUTCHours()).padStart(2, '0');
  const mi = String(date.getUTCMinutes()).padStart(2, '0');
  const s = String(date.getUTCSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d}_${h}${mi}${s}`;
}

/** Unlink a file if it exists, swallowing errors */
function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    // best-effort cleanup
  }
}

// ==================== EXPORTS ====================

export { encryptBuffer, decryptBuffer };
export type { S3ListObject };
