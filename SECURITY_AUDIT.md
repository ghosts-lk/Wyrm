# 🐉 WYRM SECURITY PENTEST REPORT
## DEFCON Level Security Assessment

**Target:** Wyrm MCP Server v3.0.0  
**Assessment Date:** February 5, 2026  
**Assessor:** Ghost Protocol Security Team  
**Classification:** CONFIDENTIAL - PROPRIETARY  

---

## EXECUTIVE SUMMARY

| Severity | Count | Status |
|----------|-------|--------|
| 🔴 CRITICAL | 3 | Needs Immediate Fix |
| 🟠 HIGH | 5 | Needs Fix |
| 🟡 MEDIUM | 6 | Should Fix |
| 🔵 LOW | 4 | Consider Fixing |
| ✅ PASSED | 8 | Secure |

**Overall Risk Level:** HIGH - Multiple critical vulnerabilities in HTTP server and file operations.

---

## 🔴 CRITICAL VULNERABILITIES

### CRIT-001: Command Injection via execSync
**Location:** `database.ts:313-329`  
**CVSS Score:** 9.8 (Critical)

```typescript
// VULNERABLE CODE
repo = execSync('git config --get remote.origin.url', { 
  cwd: projectPath,  // USER-CONTROLLED PATH
  encoding: 'utf-8',
  timeout: 5000 
}).trim();
```

**Attack Vector:**
```bash
# Attacker provides malicious project path
projectPath = "/tmp/; cat /etc/passwd #"
# Or via MCP tool call with path injection
```

**Impact:** Remote Code Execution - attacker can execute arbitrary commands.

**Fix Required:**
```typescript
import { spawn } from 'child_process';

// Validate path first
if (!existsSync(projectPath) || !statSync(projectPath).isDirectory()) {
  throw new Error('Invalid project path');
}

// Use spawn with array args (no shell)
const result = spawnSync('git', ['config', '--get', 'remote.origin.url'], {
  cwd: projectPath,
  encoding: 'utf-8',
  timeout: 5000,
  shell: false  // CRITICAL: No shell interpretation
});
```

---

### CRIT-002: Path Traversal in File Operations
**Location:** `sync.ts:27-55`, `sync.ts:68-75`  
**CVSS Score:** 9.1 (Critical)

```typescript
// VULNERABLE CODE
const wyrmPath = join(projectPath, '.wyrm');
const hoardPath = join(wyrmPath, 'hoard.md');
const content = readFileSync(hoardPath, 'utf-8');  // No path validation!

// Export also vulnerable
writeFileSync(join(wyrmPath, 'hoard.md'), hoardContent);
```

**Attack Vector:**
```javascript
// Attacker provides:
projectPath = "../../../etc"
// Results in reading /etc/.wyrm/hoard.md or writing to sensitive locations
```

**Impact:** Arbitrary file read/write, potential credential theft, configuration tampering.

**Fix Required:**
```typescript
import { resolve, relative } from 'path';

function validatePath(basePath: string, targetPath: string): string {
  const resolved = resolve(basePath, targetPath);
  const rel = relative(basePath, resolved);
  
  if (rel.startsWith('..') || resolve(resolved) !== resolved) {
    throw new Error('Path traversal detected');
  }
  return resolved;
}

// Usage
const wyrmPath = validatePath(projectPath, '.wyrm');
```

---

### CRIT-003: No Authentication on HTTP Server
**Location:** `http-server.ts`, `http-fast.ts`  
**CVSS Score:** 9.0 (Critical)

```typescript
// NO AUTHENTICATION - Anyone on network can access
const server = http.createServer(async (req, res) => {
  // ... handles requests with no auth check
});
```

**Attack Vector:**
```bash
# Anyone can access all data
curl http://localhost:3333/projects
curl http://localhost:3333/llm-context
curl -X POST http://localhost:3333/maintenance -d '{"action":"vacuum"}'
```

**Impact:** Complete data exposure, unauthorized data modification, DoS via maintenance.

**Fix Required:**
```typescript
// Add API key authentication
const API_KEY = process.env.WYRM_API_KEY || WyrmCrypto.generateSecureToken();

function authenticate(req: http.IncomingMessage): boolean {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return false;
  }
  const token = authHeader.slice(7);
  return WyrmCrypto.verifyHash(token, API_KEY_HASH);
}

// In request handler
if (!authenticate(req)) {
  return errorResponse(res, 'Unauthorized', 401);
}
```

---

## 🟠 HIGH VULNERABILITIES

### HIGH-001: SQL Injection via FTS5 MATCH
**Location:** `database.ts:500-516`  
**CVSS Score:** 7.5 (High)

```typescript
// POTENTIALLY VULNERABLE - FTS5 MATCH syntax injection
return this.db.prepare(`
  SELECT s.* FROM sessions s
  JOIN sessions_fts fts ON s.id = fts.rowid
  WHERE sessions_fts MATCH ?  // Query passed directly
  ORDER BY s.date DESC
  LIMIT 50
`).all(query) as Session[];
```

**Attack Vector:**
```javascript
// FTS5 special syntax can cause issues
query = '* OR 1=1 --'
query = 'title:* AND (SELECT * FROM sqlite_master)'
```

**Impact:** Information disclosure, potential data extraction.

**Fix Required:**
```typescript
function sanitizeFtsQuery(query: string): string {
  // Remove FTS5 special characters
  return query.replace(/[*"():^]/g, ' ').trim();
}

// Usage
const sanitized = sanitizeFtsQuery(query);
if (!sanitized) throw new Error('Invalid search query');
```

---

### HIGH-002: Denial of Service via Unbounded Queries
**Location:** `database.ts:687-702`  
**CVSS Score:** 7.0 (High)

```typescript
// No limit on streaming - can exhaust memory
*streamData(projectId: number, category?: string): Generator<DataPoint> {
  // Streams ALL data with no limit
}

// Batch insert with no size limit
insertDataBatch(data: Array<...>): number {
  // Can insert millions of rows in one call
}
```

**Attack Vector:**
```javascript
// Insert millions of data points
await fetch('/data/batch', {
  body: JSON.stringify({ items: Array(1000000).fill({...}) })
});
```

**Impact:** Memory exhaustion, database bloat, service unavailability.

**Fix Required:**
```typescript
private readonly MAX_BATCH_SIZE = 10000;
private readonly MAX_STREAM_ROWS = 100000;

insertDataBatch(data: Array<...>): number {
  if (data.length > this.MAX_BATCH_SIZE) {
    throw new Error(`Batch size exceeds limit of ${this.MAX_BATCH_SIZE}`);
  }
  // ...
}
```

---

### HIGH-003: Sensitive Data Exposure in Logs
**Location:** `sync.ts:97`  
**CVSS Score:** 6.5 (High)

```typescript
console.log(`[Wyrm] File changed: ${filename}`);  // May leak sensitive paths
```

**Impact:** Information leakage via logs.

**Fix Required:** Use structured logging with sanitization (logger.ts is available but not used).

---

### HIGH-004: Insecure Default Encryption Configuration
**Location:** `crypto.ts:38-42`  
**CVSS Score:** 6.8 (High)

```typescript
this.config = {
  enabled: config?.enabled ?? false,  // DISABLED BY DEFAULT!
  // ...
};
```

**Impact:** Sensitive data stored in plaintext by default.

**Fix Required:** Enable encryption by default or force user to make explicit choice.

---

### HIGH-005: Hardcoded Salt in Master Key Derivation
**Location:** `crypto.ts:52-54`  
**CVSS Score:** 6.0 (High)

```typescript
// HARDCODED SALT - Same for all installations!
const salt = createHash('sha256').update('wyrm-master-salt').digest();
this.masterKey = scryptSync(password, salt, KEY_LENGTH);
```

**Attack Vector:** Rainbow table attacks across installations.

**Fix Required:**
```typescript
// Use per-installation random salt stored in config
const configPath = join(homedir(), '.wyrm', 'config.json');
let salt: Buffer;
if (existsSync(configPath)) {
  const config = JSON.parse(readFileSync(configPath, 'utf-8'));
  salt = Buffer.from(config.masterSalt, 'hex');
} else {
  salt = randomBytes(32);
  writeFileSync(configPath, JSON.stringify({ masterSalt: salt.toString('hex') }));
}
```

---

## 🟡 MEDIUM VULNERABILITIES

### MED-001: Missing Rate Limiting
**Location:** `http-server.ts`, `http-fast.ts`  
**CVSS Score:** 5.3 (Medium)

No rate limiting on any endpoints. Vulnerable to brute force and resource exhaustion.

---

### MED-002: CORS Wildcard Allows Any Origin
**Location:** `http-server.ts:37`, `http-fast.ts:22`

```typescript
'Access-Control-Allow-Origin': '*'  // Too permissive
```

---

### MED-003: No Input Validation on MCP Tools
**Location:** `index.ts:280+`

Tool arguments are cast directly without validation:
```typescript
const { path, watch, recursive } = args as { path: string; ... };
```

---

### MED-004: Weak Token Estimation
**Location:** `database.ts:836`

```typescript
private estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);  // Inaccurate, can be manipulated
}
```

---

### MED-005: No TLS/HTTPS Support
**Location:** `http-server.ts`, `http-fast.ts`

HTTP only - data transmitted in plaintext.

---

### MED-006: Cache Without TTL in http-fast.ts
**Location:** `http-fast.ts:46`

Cache can grow unbounded and serve stale data.

---

## 🔵 LOW VULNERABILITIES

### LOW-001: Error Messages May Leak Information
Stack traces and internal paths exposed in error responses.

### LOW-002: No Request Size Limits
Body parser has no max size check.

### LOW-003: Synchronous File Operations
Can block event loop under load.

### LOW-004: Missing Security Headers
No CSP, X-Frame-Options, etc. on HTTP responses.

---

## ✅ SECURE IMPLEMENTATIONS

| Component | Status | Notes |
|-----------|--------|-------|
| AES-256-GCM Encryption | ✅ PASS | Proper IV, salt, auth tag |
| Constant-time Hash Comparison | ✅ PASS | Prevents timing attacks |
| Prepared Statements (SQLite) | ✅ PASS | Parameterized queries |
| WAL Mode | ✅ PASS | Good for concurrent access |
| Scrypt Key Derivation | ✅ PASS | Strong KDF (fix salt issue) |
| Foreign Key Constraints | ✅ PASS | ON DELETE CASCADE |
| Token Generation | ✅ PASS | crypto.randomBytes |
| Auth Tag in Encryption | ✅ PASS | GCM provides authenticity |

---

## REMEDIATION PRIORITY

### Immediate (Before Any Deployment)
1. CRIT-001: Fix command injection in execSync
2. CRIT-002: Add path validation to all file operations
3. CRIT-003: Add authentication to HTTP servers

### High Priority (Within 1 Week)
4. HIGH-001: Sanitize FTS queries
5. HIGH-002: Add limits to batch operations
6. HIGH-004: Enable encryption by default
7. HIGH-005: Use random per-installation salt

### Medium Priority (Within 2 Weeks)
8. Add rate limiting
9. Restrict CORS
10. Add input validation to MCP tools
11. Add TLS support

---

## RECOMMENDATIONS

1. **Security-First Defaults:** Enable encryption, authentication by default
2. **Input Validation Library:** Create centralized validation for all inputs
3. **Security Logging:** Log security events (auth failures, suspicious queries)
4. **Dependency Audit:** Run `npm audit` regularly
5. **Penetration Testing:** Schedule quarterly pentests
6. **Bug Bounty:** Consider responsible disclosure program

---

**Report Generated:** 2026-02-05  
**Classification:** PROPRIETARY - Ghost Protocol (Pvt) Ltd  
**Next Review:** After remediation implementation
