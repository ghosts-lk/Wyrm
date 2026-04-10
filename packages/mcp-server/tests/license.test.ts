/**
 * License system tests — key generation, signing, verification, tier features, activation
 */

import {
  generateKeyPair,
  generateLicenseKey,
  createLicense,
  signLicense,
  verifyLicense,
  resolveFeaturesForTier,
  TIER_FEATURES,
  TIER_DEVICE_LIMITS,
  resetLicense,
  getLicenseInfo,
  getTier,
  hasFeature,
  type LicenseTier,
  type WyrmLicense,
  type SignedLicense,
} from '../src/license.js';

// ==================== Key Generation ====================

describe('Key Generation', () => {
  it('generates an Ed25519 key pair', () => {
    const { publicKey, privateKey } = generateKeyPair();
    expect(publicKey).toContain('-----BEGIN PUBLIC KEY-----');
    expect(privateKey).toContain('-----BEGIN PRIVATE KEY-----');
  });

  it('generates unique keys each time', () => {
    const kp1 = generateKeyPair();
    const kp2 = generateKeyPair();
    expect(kp1.publicKey).not.toBe(kp2.publicKey);
    expect(kp1.privateKey).not.toBe(kp2.privateKey);
  });
});

// ==================== License Key Format ====================

describe('License Key Format', () => {
  it('generates keys in WRM-XXXX-XXXX-XXXX-XXXX format', () => {
    const key = generateLicenseKey();
    expect(key).toMatch(/^WRM-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  });

  it('generates unique keys', () => {
    const keys = new Set<string>();
    for (let i = 0; i < 100; i++) {
      keys.add(generateLicenseKey());
    }
    expect(keys.size).toBe(100);
  });

  it('does not contain ambiguous characters (I, L, O, 1)', () => {
    for (let i = 0; i < 50; i++) {
      const key = generateLicenseKey();
      const body = key.replace(/^WRM-/, '').replace(/-/g, '');
      expect(body).not.toMatch(/[ILO1]/);
    }
  });
});

// ==================== License Creation ====================

describe('License Creation', () => {
  it('creates a free license', () => {
    const license = createLicense('user@test.com', 'free');
    expect(license.key).toMatch(/^WRM-/);
    expect(license.product).toBe('wyrm');
    expect(license.tier).toBe('free');
    expect(license.issued_to).toBe('user@test.com');
    expect(license.max_devices).toBe(TIER_DEVICE_LIMITS.free);
    expect(license.features).toContain('local_storage');
  });

  it('creates a pro license with inherited features', () => {
    const license = createLicense('pro@test.com', 'pro');
    expect(license.tier).toBe('pro');
    expect(license.features).toContain('local_storage');
    expect(license.features).toContain('encryption');
    expect(license.features).toContain('analytics');
  });

  it('creates a license with expiry', () => {
    const expiresAt = new Date(Date.now() + 365 * 86400000).toISOString();
    const license = createLicense('user@test.com', 'pro', { expiresAt });
    expect(license.expires_at).toBe(expiresAt);
  });

  it('creates a perpetual license when no expiry set', () => {
    const license = createLicense('user@test.com', 'pro');
    expect(license.expires_at).toBeNull();
  });

  it('supports extra features', () => {
    const license = createLicense('user@test.com', 'free', {
      extraFeatures: ['beta_feature'],
    });
    expect(license.features).toContain('beta_feature');
    expect(license.features).toContain('local_storage');
  });

  it('supports hardware binding', () => {
    const license = createLicense('user@test.com', 'pro', {
      hardwareId: 'abc123',
    });
    expect(license.hardware_id).toBe('abc123');
  });
});

// ==================== Tier Features ====================

describe('Tier Feature Resolution', () => {
  it('resolves free tier features', () => {
    const features = resolveFeaturesForTier('free');
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.free));
    // Should NOT include pro features
    expect(features).not.toContain('encryption');
  });

  it('resolves pro tier with cumulative features', () => {
    const features = resolveFeaturesForTier('pro');
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.free));
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.pro));
  });

  it('resolves team tier with cumulative features', () => {
    const features = resolveFeaturesForTier('team');
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.free));
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.pro));
    expect(features).toEqual(expect.arrayContaining(TIER_FEATURES.team));
  });

  it('resolves enterprise tier with all features', () => {
    const features = resolveFeaturesForTier('enterprise');
    for (const tier of ['free', 'pro', 'team', 'enterprise'] as LicenseTier[]) {
      expect(features).toEqual(expect.arrayContaining(TIER_FEATURES[tier]));
    }
  });

  it('returns deduplicated features', () => {
    const features = resolveFeaturesForTier('enterprise');
    const unique = new Set(features);
    expect(features.length).toBe(unique.size);
  });
});

// ==================== Signing & Verification ====================

describe('License Signing & Verification', () => {
  let keys: { publicKey: string; privateKey: string };

  beforeAll(() => {
    keys = generateKeyPair();
  });

  it('signs and verifies a valid license', () => {
    const license = createLicense('user@test.com', 'pro');
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(true);
    expect(result.tier).toBe('pro');
    expect(result.features).toEqual(expect.arrayContaining(['encryption']));
    expect(result.error).toBeUndefined();
  });

  it('rejects a tampered license', () => {
    const license = createLicense('user@test.com', 'pro');
    const signed = signLicense(license, keys.privateKey);

    // Tamper with the license
    signed.license.tier = 'enterprise';

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid signature');
  });

  it('rejects a license with wrong public key', () => {
    const license = createLicense('user@test.com', 'pro');
    const signed = signLicense(license, keys.privateKey);

    const otherKeys = generateKeyPair();
    const result = verifyLicense(signed, otherKeys.publicKey);
    expect(result.valid).toBe(false);
  });

  it('rejects an expired license', () => {
    const pastDate = new Date(Date.now() - 86400000).toISOString(); // yesterday
    const license = createLicense('user@test.com', 'pro', { expiresAt: pastDate });
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('expired');
  });

  it('accepts a non-expired license', () => {
    const futureDate = new Date(Date.now() + 365 * 86400000).toISOString();
    const license = createLicense('user@test.com', 'pro', { expiresAt: futureDate });
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(true);
  });

  it('accepts a perpetual license (no expiry)', () => {
    const license = createLicense('user@test.com', 'enterprise');
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(true);
    expect(result.expiresAt).toBeNull();
  });

  it('rejects a license with wrong product', () => {
    const license = createLicense('user@test.com', 'pro');
    license.product = 'not-wyrm';
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, keys.publicKey);
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid product');
  });

  it('rejects an invalid public key PEM', () => {
    const license = createLicense('user@test.com', 'pro');
    const signed = signLicense(license, keys.privateKey);

    const result = verifyLicense(signed, 'INVALID PEM');
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Invalid public key');
  });
});

// ==================== Singleton State ====================

describe('License Singleton (getLicenseInfo, getTier, hasFeature, resetLicense)', () => {
  afterEach(() => {
    resetLicense();
  });

  it('defaults to free tier', () => {
    resetLicense();
    expect(getTier()).toBe('free');
    expect(hasFeature('local_storage')).toBe(true);
    expect(hasFeature('encryption')).toBe(false);
  });

  it('getLicenseInfo returns free state when no license loaded', () => {
    resetLicense();
    const info = getLicenseInfo();
    expect(info.tier).toBe('free');
    expect(info.valid).toBe(false);
    expect(info.issuedTo).toBeNull();
    expect(info.key).toBeNull();
  });

  it('resetLicense clears to free tier', () => {
    resetLicense();
    expect(getTier()).toBe('free');
    expect(hasFeature('encryption')).toBe(false);
  });
});
