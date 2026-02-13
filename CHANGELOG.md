# Changelog

All notable changes to Wyrm will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [3.1.0] - 2025-07-13

### Added

- **Prompt Caching & Credit Savings**
  - MCP `cache_control` hints on all read-only tool responses (Claude, etc. can cache these blocks)
  - In-memory response cache with per-tool TTL (15-60s) — repeated reads served from memory
  - Automatic cache invalidation on write operations (session updates, quest changes, etc.)
  - Response fingerprinting for delta detection

- **Usage Tracking** (`wyrm_usage` tool)
  - Track token consumption per tool call (input + output estimates)
  - Cache hit rate monitoring
  - Cost estimation at Claude Opus pricing ($15/M in, $75/M out)
  - Top tools by token usage breakdown
  - Reset counters with `reset: true`

- **Performance Improvements**
  - `MemCache` now wired into tool handler (was defined but unused)
  - Cache stats include hit/miss counters and hit rate percentage
  - Default cache TTL increased from 30s to 60s for better credit savings
  - Compact project list responses (less verbose, fewer tokens)
  - `guardSize()` and `estimateTokens()` imported for response optimization

### Changed

- Server version bumped to 3.1.0
- `wyrm_stats` now includes cache and usage statistics
- Read-only tools (`list_projects`, `project_context`, `global_context`, `all_quests`, `data_query`, `data_categories`, `search`, `stats`) automatically cached
- Write tools (`session_start/update`, `quest_add/complete`, `data_insert`, `set_global`, etc.) automatically invalidate relevant caches

## [3.0.0] - 2026-02-04

### Added

- **Encryption Module** (`crypto.ts`)
  - AES-256-GCM encryption for sensitive data
  - Password-based key derivation with scrypt
  - `maybeEncrypt`/`maybeDecrypt` for transparent encryption
  - Secure token generation and hash verification

- **Logger Module** (`logger.ts`)
  - Structured logging with levels (debug, info, warn, error)
  - Correlation ID support for request tracing
  - File and console output options
  - JSON and human-readable formats
  - Performance timing helpers

- **CLI Module** (`cli.ts`)
  - Beautiful colored output with ANSI codes
  - Progress spinners and bars
  - Table and box formatters
  - ASCII art banner
  - Priority and status icons

- **Types Module** (`types.ts`)
  - Comprehensive TypeScript interfaces
  - Tool argument types
  - API request/response types
  - Event types for extensibility
  - Default configuration

### Changed

- **Package.json**
  - Version bump to 3.0.0
  - Added author, homepage, repository, bugs fields
  - Added keywords for npm discoverability
  - Added lint, test, and clean scripts
  - Added dev dependencies for testing and linting

- **README.md**
  - Complete rewrite with professional documentation
  - Architecture diagram
  - Feature table
  - Installation options
  - Quick start guide
  - HTTP API reference

### Technical

- WAL mode enabled by default
- 64MB cache for improved performance
- Full-text search with FTS5
- Batch operations for bulk imports
- Token estimation for context budgeting

## [2.2.0] - 2026-02-03

### Added

- HTTP fast server (`http-fast.ts`)
- Auto-deploy script (`wyrm-deploy.sh`)
- Copilot integration documentation

### Fixed

- Shebang lines for CLI commands
- npm link compatibility

## [2.1.0] - 2026-02-02

### Added

- Data lake operations
- Global context support
- Session archiving

## [2.0.0] - 2026-02-01

### Added

- Complete MCP server implementation
- SQLite database with better-sqlite3
- Full-text search
- Project auto-discovery
- Watch directories
- Sync with .wyrm folders

### Changed

- Migrated from file-based to SQLite storage
- Added batch operations

## [1.0.0] - 2026-01-15

### Added

- Initial release
- Basic .wyrm folder structure
- Manual sync scripts
- VS Code extension skeleton
