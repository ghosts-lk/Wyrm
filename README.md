# 🐉 Wyrm — Persistent Memory for AI Agents

> Your AI forgets everything between sessions. Wyrm remembers.

[![npm version](https://img.shields.io/npm/v/@wyrm/mcp-server?color=22c55e&label=npm)](https://www.npmjs.com/package/@wyrm/mcp-server)
[![License: AGPL-3.0](https://img.shields.io/badge/License-AGPL--3.0-blue.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-79%20passing-22c55e)](packages/mcp-server)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![MCP](https://img.shields.io/badge/MCP-compatible-purple)](https://modelcontextprotocol.io)

---

## The Problem

AI assistants lose all context between conversations. Every new session starts from zero — you re-explain your codebase, your preferences, your project architecture, the decisions you already made. It's like working with a brilliant colleague who has amnesia.

## The Solution

Wyrm is an [MCP](https://modelcontextprotocol.io) server that gives AI agents **persistent, searchable memory**. It stores projects, sessions, quests, skills, and arbitrary data in a local SQLite database with full-text search. Connect it once, and your AI remembers everything — across sessions, across tools, across projects.

```
You: "What did we decide about the auth architecture last week?"
AI:  *checks Wyrm* "We went with JWT + refresh tokens, stored in httpOnly cookies.
      Here's the session from Tuesday with the full discussion..."
```

---

## Features

- 🧠 **Persistent Memory** — Projects, sessions, quests, context, and skills survive across sessions
- 🔍 **Full-Text Search** — FTS5-powered instant search across all stored data
- 📊 **Data Lake** — Store and query any structured data with namespaces and metadata
- 🎯 **Quest Tracking** — Task management with priorities, tags, and cross-project visibility
- 🔒 **Optional Encryption** — AES-256-GCM for sensitive data, keys never leave your machine
- 🛡️ **Input Sanitization** — Built-in security against injection attacks
- 📈 **Usage Analytics** — Token tracking, cost estimation, session metrics
- 🔄 **Markdown Sync** — Bi-directional sync between database and `.wyrm/` project files
- 🚀 **Zero Config** — Install, connect, done. No databases to set up, no services to run.

---

## Quick Start

### 1. Install

```bash
# From source (recommended for now)
git clone https://github.com/ghosts-lk/Wyrm.git
cd Wyrm/packages/mcp-server
npm install && npm run build
npm link
```

### 2. Connect to Your AI

Add Wyrm to your AI client's MCP configuration:

<details>
<summary><strong>Claude Desktop</strong></summary>

Edit `~/.config/claude/claude_desktop_config.json` (Linux) or `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS):

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>GitHub Copilot (VS Code)</strong></summary>

Add to `.vscode/settings.json` or your user settings:

```json
{
  "mcp": {
    "servers": {
      "wyrm": {
        "command": "wyrm-mcp"
      }
    }
  }
}
```

</details>

<details>
<summary><strong>GitHub Copilot CLI</strong></summary>

Add to `~/.copilot/mcp-config.json`:

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>Cursor</strong></summary>

Add to `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

</details>

<details>
<summary><strong>Windsurf</strong></summary>

Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

</details>

Or run **`wyrm-setup`** to auto-detect and configure all installed AI clients at once.

### 3. Use It

Once connected, your AI has access to all Wyrm tools. Try:

```
"Scan ~/projects for git repositories"
"Start a session for my auth refactor"
"What quests are pending across all projects?"
"Search my memory for anything about database migrations"
```

---

## MCP Tools Reference

Wyrm exposes 31 tools via the Model Context Protocol:

### Projects

| Tool | Description |
|------|-------------|
| `wyrm_scan_projects` | Discover git projects in a directory tree |
| `wyrm_list_projects` | List all registered projects with metadata |
| `wyrm_project_context` | Get full context for a project (sessions, quests, data) |
| `wyrm_global_context` | Overview across all projects |

### Sessions

| Tool | Description |
|------|-------------|
| `wyrm_session_start` | Start or continue a named session with context |
| `wyrm_session_update` | Update session with completed work, decisions, and notes |

### Quests (Task Tracking)

| Tool | Description |
|------|-------------|
| `wyrm_quest_add` | Add a task with priority, tags, and description |
| `wyrm_quest_complete` | Mark a task as done with completion notes |
| `wyrm_all_quests` | List pending tasks across all projects |

### Data Lake

| Tool | Description |
|------|-------------|
| `wyrm_data_insert` | Store a data point with namespace and metadata |
| `wyrm_data_batch_insert` | Bulk insert for large datasets |
| `wyrm_data_query` | Query stored data by namespace, key, or content |
| `wyrm_data_categories` | List all data categories for a project |

### Skills Registry

| Tool | Description |
|------|-------------|
| `wyrm_skill_register` | Register or update a skill with metadata |
| `wyrm_skill_list` | List skills with filtering options |
| `wyrm_skill_get` | Get detailed skill information |
| `wyrm_skill_search` | Search skills by name, description, or tags |
| `wyrm_skill_activate` / `wyrm_skill_deactivate` | Toggle skill status |
| `wyrm_skill_delete` | Remove a skill |
| `wyrm_skill_stats` | Skill registry statistics |

### Search & Utilities

| Tool | Description |
|------|-------------|
| `wyrm_search` | Full-text search across all projects, sessions, quests, and data |
| `wyrm_set_global` | Set global context that applies across all projects |
| `wyrm_sync` | Sync database with `.wyrm/` markdown files |
| `wyrm_stats` | Database statistics and health |
| `wyrm_usage` | Token usage stats, cache hit rates, and cost estimates |
| `wyrm_maintenance` | Vacuum, archive old data, optimize indexes |
| `wyrm_setup` | Auto-configure Wyrm in all detected AI clients |

### Auto-Orchestration

| Tool | Description |
|------|-------------|
| `wyrm_orchestrate_task` | Classify a task and get an orchestration plan |
| `wyrm_orchestration_config` | View or update orchestration settings |
| `wyrm_orchestration_stats` | Orchestration effectiveness and task distribution |

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `WYRM_DB_PATH` | `~/.wyrm/wyrm.db` | SQLite database location |
| `WYRM_ENCRYPTION_KEY` | *(none)* | AES-256-GCM encryption key for sensitive data |
| `WYRM_LOG_LEVEL` | `info` | Logging level (`debug`, `info`, `warn`, `error`) |
| `WYRM_HTTP_PORT` | `3333` | HTTP API server port |

### Encryption

To enable encryption for sensitive context data:

```bash
# Generate a key
openssl rand -hex 32

# Set it before starting Wyrm
export WYRM_ENCRYPTION_KEY="your-64-char-hex-key"
```

All encryption happens locally. Keys never leave your machine.

### Per-Project Files

Each tracked project gets a `.wyrm/` directory:

```
project/
└── .wyrm/
    ├── hoard.md        # 🐉 Project knowledge — architecture, decisions, context
    ├── chronicles.md   # 📜 Session history — what was discussed and built
    ├── quests.md       # ⚔️ Task queue — pending and completed work
    └── protocol.md     # 🔥 AI guidelines — project-specific instructions
```

These sync bi-directionally with the SQLite database via `wyrm_sync`.

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AI Assistants                         │
│     (Copilot · Claude · Cursor · Windsurf · Zed)        │
└────────────────────────┬────────────────────────────────┘
                         │ MCP (stdio)
                         ▼
┌─────────────────────────────────────────────────────────┐
│                  Wyrm MCP Server                        │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ Projects │  │ Sessions │  │  Quests  │  │ Skills │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐  │
│  │ DataLake │  │  Search  │  │  Crypto  │  │  Sync  │  │
│  │          │  │  (FTS5)  │  │(AES-256) │  │  (.md) │  │
│  └──────────┘  └──────────┘  └──────────┘  └────────┘  │
│                                                         │
│              SQLite Database (WAL mode)                  │
│              Optional HTTP API (:3333)                   │
└─────────────────────────────────────────────────────────┘
```

**Stack:** TypeScript · Node.js · better-sqlite3 · FTS5 · MCP SDK

---

## Development

```bash
# Clone and install
git clone https://github.com/ghosts-lk/Wyrm.git
cd Wyrm/packages/mcp-server
npm install

# Build
npm run build

# Run tests
npm test

# Watch mode
npm run dev
```

### Project Structure

```
Wyrm/
├── packages/
│   ├── mcp-server/          # Core MCP server
│   │   ├── src/
│   │   │   ├── index.ts     # MCP tool definitions & server
│   │   │   ├── database.ts  # SQLite schema & queries
│   │   │   ├── crypto.ts    # AES-256-GCM encryption
│   │   │   ├── security.ts  # Input sanitization
│   │   │   └── ...
│   │   ├── tests/           # Jest test suite
│   │   └── package.json
│   └── vscode-extension/    # VS Code extension (optional)
├── config/                  # Configuration templates
├── templates/               # Project template files
├── docs/                    # Documentation
├── examples/                # Usage examples
└── scripts/                 # Utility scripts
```

---

## Contributing

Contributions are welcome! Here's how:

1. **Fork** the repository
2. **Create** a feature branch (`git checkout -b feat/amazing-feature`)
3. **Commit** your changes (`git commit -m 'feat: add amazing feature'`)
4. **Push** to the branch (`git push origin feat/amazing-feature`)
5. **Open** a Pull Request

Please ensure tests pass (`npm test`) and the project builds (`npm run build`) before submitting.

---

## Security

- **Local-only** — All data stored on your machine. Nothing leaves by default.
- **No telemetry** — Zero data collection, zero phone-home.
- **Optional encryption** — AES-256-GCM for sensitive context data.
- **Audited** — Security audits documented in [SECURITY_AUDIT.md](SECURITY_AUDIT.md) and [SECURITY_AUDIT_V2.md](SECURITY_AUDIT_V2.md).

Found a vulnerability? Please open an issue or email security@ghosts.lk.

---

## License

[AGPL-3.0](LICENSE) — Copyright © 2024-2026 [Ghost Protocol (Pvt) Ltd](https://ghosts.lk)

For commercial licensing (e.g. embedding Wyrm in proprietary products), contact [ghosts.lk@proton.me](mailto:ghosts.lk@proton.me).

---

<div align="center">

*The dragon remembers.* 🐉

Built by [Ghost Protocol](https://ghosts.lk)

</div>
