/**
 * Wyrm License System
 * ED25519 license key generation, signing, and offline verification
 * 
 * @copyright 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.
 * @license Proprietary - See LICENSE file for details.
 * @module license
 * @version 3.2.0
 */

import {
  createPrivateKey,
  createPublicKey,
  sign,
  verify,
  generateKeyPairSync,
  randomBytes,
  KeyObject,
} from 'crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, chmodSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

// ==================== TYPES ====================

/** Supported license tiers */
export type LicenseTier = 'free' | 'pro' | 'team' | 'enterprise';

/** Core license data payload */
export interface WyrmLicense {
  /** License key in WRM-XXXX-XXXX-XXXX-XXXX format */
  key: string;
  /** Product identifier */
  product: string;
  /** License tier */
  tier: LicenseTier;
  /** Email of the licensee */
  issued_to: string;
  /** ISO 8601 issue date */
  issued_at: string;
  /** ISO 8601 expiry date, or null for perpetual */
  expires_at: string | null;
  /** Max bound devices (−1 = unlimited) */
  max_devices: number;
  /** Enabled feature flags */
  features: string[];
  /** Optional hardware fingerprint for device binding */
  hardware_id?: string;
}

/** A license bundled with its Ed25519 signature */
export interface SignedLicense {
  license: WyrmLicense;
  /** Base64-encoded Ed25519 signature over the canonical payload */
  signature: string;
}

/** Result of a license verification check */
export interface LicenseValidation {
  valid: boolean;
  tier: LicenseTier;
  features: string[];
  expiresAt: string | null;
  error?: string;
}

// ==================== CONSTANTS ====================

/** Base32 alphabet without visually-ambiguous characters (no I, L, O, 1) */
const BASE32_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ234567890';

/** License key prefix */
const KEY_PREFIX = 'WRM';

/** Bytes of entropy per key segment (4 chars each) */
const KEY_SEGMENT_COUNT = 4;
const KEY_SEGMENT_LENGTH = 4;

/** License file location */
const WYRM_DIR = join(homedir(), '.wyrm');
const LICENSE_PATH = join(WYRM_DIR, 'license.json');

/**
 * Feature gates per tier.
 * Each tier inherits all features from lower tiers plus its own additions.
 */
export const TIER_FEATURES: Record<LicenseTier, string[]> = {
  free: ['local_storage', 'all_tools', 'fts_search', 'unlimited_projects'],
  pro: ['cloud_backup', 'encryption', 'analytics', 'priority_support'],
  team: ['shared_memory', 'workspaces', 'admin_dashboard', 'slack_integration'],
  enterprise: ['unlimited_seats', 'sso_saml', 'custom_sla', 'on_premise'],
};

/** Ordered tiers for cumulative feature resolution */
const TIER_ORDER: LicenseTier[] = ['free', 'pro', 'team', 'enterprise'];

/** Default device limits per tier */
export const TIER_DEVICE_LIMITS: Record<LicenseTier, number> = {
  free: 1,
  pro: 1,
  team: 25,
  enterprise: -1,
};

/**
 * Embedded public key for offline verification.
 * Replace this PEM after running `generateKeyPair()` for the first time.
 */
const WYRM_PUBLIC_KEY = `-----BEGIN PUBLIC KEY-----
MCowBQYDK2VwAyEAVALIDKEYWILLBEPLACEDHEREAFTERGEN00000000000=
-----END PUBLIC KEY-----`;

// ==================== SINGLETON STATE ====================

let currentLicense: SignedLicense | null = null;
let currentTier: LicenseTier = 'free';
let currentFeatures: Set<string> = new Set(TIER_FEATURES.free);

// ==================== HELPERS ====================

/**
 * Resolve the cumulative feature set for a given tier.
 * E.g. `team` gets free + pro + team features.
 */
export function resolveFeaturesForTier(tier: LicenseTier): string[] {
  const idx = TIER_ORDER.indexOf(tier);
  const features: string[] = [];
  for (let i = 0; i <= idx; i++) {
    features.push(...TIER_FEATURES[TIER_ORDER[i]]);
  }
  return [...new Set(features)];
}

/**
 * Build the canonical string representation of a license for signing/verification.
 * Field order is fixed so both signer and verifier produce identical payloads.
 */
function buildCanonicalPayload(license: WyrmLicense): string {
  return [
    license.key,
    license.product,
    license.tier,
    license.issued_to,
    license.issued_at,
    license.expires_at ?? 'perpetual',
    String(license.max_devices),
    license.features.sort().join(','),
    license.hardware_id ?? '',
  ].join('|');
}

/**
 * Encode random bytes into a Base32 string of the given length
 * using our custom visually-unambiguous alphabet.
 */
function randomBase32(length: number): string {
  const bytes = randomBytes(length);
  let result = '';
  for (let i = 0; i < length; i++) {
    result += BASE32_ALPHABET[bytes[i] % BASE32_ALPHABET.length];
  }
  return result;
}

// ==================== KEY GENERATION (SERVER-SIDE) ====================

/**
 * Generate an Ed25519 key pair for license signing.
 *
 * **Server-side only** — the private key must never be shipped in the client.
 *
 * @returns PEM-encoded public and private keys
 */
export function generateKeyPair(): { publicKey: string; privateKey: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519', {
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  return { publicKey, privateKey };
}

/**
 * Generate a license key in `WRM-XXXX-XXXX-XXXX-XXXX` format.
 *
 * Uses `crypto.randomBytes` mapped onto a Base32 alphabet that excludes
 * visually-ambiguous characters (I, L, O, 1).
 *
 * **Server-side only.**
 */
export function generateLicenseKey(): string {
  const segments: string[] = [];
  for (let i = 0; i < KEY_SEGMENT_COUNT; i++) {
    segments.push(randomBase32(KEY_SEGMENT_LENGTH));
  }
  return `${KEY_PREFIX}-${segments.join('-')}`;
}

/**
 * Create a new {@link WyrmLicense} with sane defaults for the given tier.
 *
 * **Server-side only.**
 *
 * @param email - Licensee email
 * @param tier - Desired tier
 * @param options - Optional overrides (expiry, hardware binding, extra features)
 */
export function createLicense(
  email: string,
  tier: LicenseTier,
  options: {
    expiresAt?: string | null;
    maxDevices?: number;
    hardwareId?: string;
    extraFeatures?: string[];
  } = {},
): WyrmLicense {
  const features = resolveFeaturesForTier(tier);
  if (options.extraFeatures) {
    for (const f of options.extraFeatures) {
      if (!features.includes(f)) features.push(f);
    }
  }

  return {
    key: generateLicenseKey(),
    product: 'wyrm',
    tier,
    issued_to: email,
    issued_at: new Date().toISOString(),
    expires_at: options.expiresAt ?? null,
    max_devices: options.maxDevices ?? TIER_DEVICE_LIMITS[tier],
    features,
    hardware_id: options.hardwareId,
  };
}

/**
 * Sign a {@link WyrmLicense} with an Ed25519 private key.
 *
 * **Server-side only.**
 *
 * @param license - The license data to sign
 * @param privateKeyPem - PEM-encoded Ed25519 private key
 * @returns The license bundled with its base64 signature
 */
export function signLicense(license: WyrmLicense, privateKeyPem: string): SignedLicense {
  const payload = buildCanonicalPayload(license);
  const key = createPrivateKey(privateKeyPem);
  const sig = sign(null, Buffer.from(payload, 'utf-8'), key);
  return {
    license,
    signature: sig.toString('base64'),
  };
}

// ==================== VERIFICATION (CLIENT-SIDE / OFFLINE) ====================

/**
 * Verify a {@link SignedLicense} against an Ed25519 public key.
 *
 * Performs three checks:
 * 1. Signature validity (Ed25519)
 * 2. Product field matches "wyrm"
 * 3. Expiry date (if present)
 *
 * Works fully offline with zero external dependencies.
 *
 * @param signed - The signed license bundle
 * @param publicKeyPem - Optional PEM override; defaults to the embedded key
 */
export function verifyLicense(
  signed: SignedLicense,
  publicKeyPem?: string,
): LicenseValidation {
  const freeFallback: LicenseValidation = {
    valid: false,
    tier: 'free',
    features: [...TIER_FEATURES.free],
    expiresAt: null,
  };

  try {
    const { license, signature } = signed;

    // Product check
    if (license.product !== 'wyrm') {
      return { ...freeFallback, error: 'Invalid product identifier' };
    }

    // Tier validity
    if (!TIER_ORDER.includes(license.tier)) {
      return { ...freeFallback, error: `Unknown tier: ${license.tier}` };
    }

    // Signature verification
    const payload = buildCanonicalPayload(license);
    const pem = publicKeyPem ?? WYRM_PUBLIC_KEY;
    let key: KeyObject;

    try {
      key = createPublicKey(pem);
    } catch {
      return { ...freeFallback, error: 'Invalid public key' };
    }

    const isValid = verify(
      null,
      Buffer.from(payload, 'utf-8'),
      key,
      Buffer.from(signature, 'base64'),
    );

    if (!isValid) {
      return { ...freeFallback, error: 'Invalid signature — license may be tampered' };
    }

    // Expiry check
    if (license.expires_at !== null) {
      const expiry = new Date(license.expires_at);
      if (isNaN(expiry.getTime())) {
        return { ...freeFallback, error: 'Malformed expiry date' };
      }
      if (expiry.getTime() < Date.now()) {
        return {
          valid: false,
          tier: license.tier,
          features: [...TIER_FEATURES.free],
          expiresAt: license.expires_at,
          error: `License expired on ${license.expires_at}`,
        };
      }
    }

    return {
      valid: true,
      tier: license.tier,
      features: [...license.features],
      expiresAt: license.expires_at,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ...freeFallback, error: `Verification failed: ${message}` };
  }
}

// ==================== FEATURE GATES ====================

/**
 * Check whether a specific feature is available in the current license.
 *
 * @param feature - Feature flag name (e.g. `"encryption"`, `"sso_saml"`)
 */
export function hasFeature(feature: string): boolean {
  return currentFeatures.has(feature);
}

/**
 * Get the current active license tier.
 * Defaults to `"free"` when no valid license is loaded.
 */
export function getTier(): LicenseTier {
  return currentTier;
}

/**
 * Return a summary of the currently-loaded license state.
 */
export function getLicenseInfo(): {
  tier: LicenseTier;
  features: string[];
  expiresAt: string | null;
  valid: boolean;
  issuedTo: string | null;
  key: string | null;
} {
  if (!currentLicense) {
    return {
      tier: 'free',
      features: [...TIER_FEATURES.free],
      expiresAt: null,
      valid: false,
      issuedTo: null,
      key: null,
    };
  }

  const validation = verifyLicense(currentLicense);
  return {
    tier: validation.tier,
    features: validation.features,
    expiresAt: validation.expiresAt,
    valid: validation.valid,
    issuedTo: currentLicense.license.issued_to,
    key: currentLicense.license.key,
  };
}

// ==================== PERSISTENCE ====================

/**
 * Load a signed license from `~/.wyrm/license.json`.
 *
 * @returns The parsed {@link SignedLicense} or `null` if not found / unparseable
 */
export function loadLicense(): SignedLicense | null {
  try {
    if (!existsSync(LICENSE_PATH)) return null;
    const raw = readFileSync(LICENSE_PATH, 'utf-8');
    const parsed = JSON.parse(raw) as SignedLicense;

    // Basic shape check
    if (!parsed.license || !parsed.signature) return null;
    if (!parsed.license.key || !parsed.license.tier) return null;

    return parsed;
  } catch {
    return null;
  }
}

/**
 * Persist a signed license to `~/.wyrm/license.json`.
 * File permissions are set to `0o600` (owner read/write only).
 *
 * @param signed - The signed license to save
 */
export function saveLicense(signed: SignedLicense): void {
  if (!existsSync(WYRM_DIR)) {
    mkdirSync(WYRM_DIR, { recursive: true });
  }
  const json = JSON.stringify(signed, null, 2);
  writeFileSync(LICENSE_PATH, json, { encoding: 'utf-8', mode: 0o600 });

  // Ensure permissions even if file existed previously
  chmodSync(LICENSE_PATH, 0o600);
}

/**
 * Activate a license from a JSON string (e.g. pasted by the user).
 *
 * Parses, verifies, and — if valid — persists the license and updates
 * the in-memory singleton state.
 *
 * @param licenseString - JSON-encoded {@link SignedLicense}
 * @returns Validation result
 */
export function activateLicense(licenseString: string): LicenseValidation {
  let signed: SignedLicense;

  try {
    signed = JSON.parse(licenseString) as SignedLicense;
  } catch {
    return {
      valid: false,
      tier: 'free',
      features: [...TIER_FEATURES.free],
      expiresAt: null,
      error: 'Invalid license format — expected JSON',
    };
  }

  if (!signed.license || !signed.signature) {
    return {
      valid: false,
      tier: 'free',
      features: [...TIER_FEATURES.free],
      expiresAt: null,
      error: 'Malformed license — missing license data or signature',
    };
  }

  const validation = verifyLicense(signed);

  if (validation.valid) {
    saveLicense(signed);
    currentLicense = signed;
    currentTier = validation.tier;
    currentFeatures = new Set(validation.features);
  }

  return validation;
}

// ==================== INITIALIZATION ====================

/**
 * Initialize the license subsystem on startup.
 *
 * Attempts to load and verify `~/.wyrm/license.json`.
 * Falls back to the free tier on any failure.
 *
 * Call this once during MCP server boot.
 */
export function initializeLicense(): void {
  const signed = loadLicense();

  if (!signed) {
    currentLicense = null;
    currentTier = 'free';
    currentFeatures = new Set(TIER_FEATURES.free);
    return;
  }

  const validation = verifyLicense(signed);

  if (validation.valid) {
    currentLicense = signed;
    currentTier = validation.tier;
    currentFeatures = new Set(validation.features);
  } else {
    // Invalid / expired — degrade gracefully
    currentLicense = null;
    currentTier = 'free';
    currentFeatures = new Set(TIER_FEATURES.free);
  }
}

/**
 * Reset the singleton state to free tier.
 * Useful for testing or license deactivation.
 */
export function resetLicense(): void {
  currentLicense = null;
  currentTier = 'free';
  currentFeatures = new Set(TIER_FEATURES.free);
}
