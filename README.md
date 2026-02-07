# 🐉 Wyrm

<div align="center">

```
██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗
██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║
██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║
██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║
╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║
 ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝
    Persistent AI Memory System v3.0.0
           ghosts.lk
```

> *"The ancient wyrm remembers all. What was spoken, what was built, what remains undone."*

**Persistent AI Memory System for Development**

[![Version](https://img.shields.io/badge/Version-3.0.0-22c55e?style=for-the-badge)]()
[![Node.js](https://img.shields.io/badge/Node.js-18+-339933?style=for-the-badge&logo=node.js)]()
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?style=for-the-badge&logo=typescript)]()
[![License](https://img.shields.io/badge/License-Proprietary-ff4444?style=for-the-badge)]()
[![MCP](https://img.shields.io/badge/MCP-Native-purple?style=for-the-badge)]()

[![CI](https://github.com/ghosts-lk/Wyrm/workflows/CI/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/ci.yml)
[![Security](https://github.com/ghosts-lk/Wyrm/workflows/Security/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/security.yml)
[![Integration](https://github.com/ghosts-lk/Wyrm/workflows/Integration%20Tests/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/integration.yml)
[![Performance](https://github.com/ghosts-lk/Wyrm/workflows/Performance/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/performance.yml)

By [Ghost Protocol](https://ghosts.lk) — *Private Repository*

</div>

---

## Overview

Wyrm is a persistent memory system that gives AI assistants long-term memory across chat sessions. It enables AI tools (GitHub Copilot, Claude, GPT) to remember project context, track work sessions, manage tasks, and store structured data — all persisted in a local SQLite database with optional AES-256-GCM encryption.

Built as a **Model Context Protocol (MCP)** server in TypeScript, Wyrm integrates natively with VS Code's Copilot Chat and any MCP-compatible AI client. It also exposes an HTTP API for programmatic access.

**Codebase:** TypeScript/Node.js, MCP server + HTTP API + VS Code extension  
**Vision:** Become the standard memory layer for AI-assisted development  
**Status:** Production-ready ✅

---

## Table of Contents

- [Key Features](#key-features)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [MCP Tools](#mcp-tools)
- [Project Structure](#project-structure)
- [Architecture](#architecture)
- [HTTP API](#http-api)
- [Docker](#docker)
- [CI/CD](#cicd)
- [Security](#security)
- [License](#license)

---

## Key Features

| Feature | Description |
|---------|-------------|
| **🧠 Persistent Memory** | SQLite-backed storage (WAL mode) that survives across chat sessions, IDE restarts, and system reboots |
| **🔍 Full-Text Search** | FTS5 search across sessions, quests, and stored data — instant results across all projects |
| **🔐 AES-256 Encryption** | Optional AES-256-GCM encryption for sensitive context data — keys never leave your machine |
| **🚀 MCP Protocol** | Native Model Context Protocol support — works out of the box with GitHub Copilot, Claude, GPT |
| **📊 Data Lake** | Store large structured datasets with batch insert/query operations for knowledge persistence |
| **🔄 Auto-Sync** | Bi-directional sync between SQLite database and `.wyrm/` markdown files in each project |
| **🎯 Quest Management** | Track tasks with priorities, tags, and cross-project visibility |
| **📈 Token Tracking** | Automatic token estimation for context budgeting — never exceed context windows |
| **🌐 HTTP API** | Full REST API on port 3333 for programmatic access and tooling integration |
| **🐳 Docker** | Container image available via GitHub Container Registry |

---

## Installation

### Option 1: NPM (Recommended)

```bash
npm install -g @wyrm/mcp-server
```

### Option 2: From Source

```bash
git clone https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm.git
cd Wyrm/packages/mcp-server
npm install && npm run build
npm link
```

### Option 3: Auto-Deploy to Projects

```bash
wyrm-deploy /path/to/your/projects
```

---

## Quick Start

### 1. Configure with GitHub Copilot

Add to your VS Code settings (`.vscode/settings.json`):

```json
{
  "github.copilot.chat.experimental.mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

### 2. Start the HTTP Server (Optional)

```bash
wyrm  # Starts on http://localhost:3333
```

### 3. Scan Your Projects

In Copilot Chat:
```
@wyrm Scan /home/user/projects for git repositories
```

### Commands

| Command | Description |
|---------|-------------|
| `wyrm-mcp` | Start MCP server (stdio mode for AI tools) |
| `wyrm` | Start HTTP API server on port 3333 |
| `wyrm-deploy <path>` | Deploy Wyrm configuration to all projects in a folder |

---

## MCP Tools

### Project Management

| Tool | Description |
|------|-------------|
| `wyrm_scan_projects` | Discover git projects in a directory tree |
| `wyrm_list_projects` | List all registered projects with metadata |
| `wyrm_project_context` | Get full context for a project (sessions, quests, data) |
| `wyrm_global_context` | Overview of all projects — cross-project visibility |

### Session Management

| Tool | Description |
|------|-------------|
| `wyrm_session_start` | Start or continue a named session with context |
| `wyrm_session_update` | Update session with completed work and decisions |

### Quest Management

| Tool | Description |
|------|-------------|
| `wyrm_quest_add` | Add a task with priority, tags, and description |
| `wyrm_quest_complete` | Mark task as done with completion notes |
| `wyrm_all_quests` | List pending tasks across all projects |

### Data Lake

| Tool | Description |
|------|-------------|
| `wyrm_data_insert` | Store individual data points with namespace and metadata |
| `wyrm_data_batch_insert` | Bulk insert for large datasets |
| `wyrm_data_query` | Query stored data by namespace, key, or content |

### Search & Maintenance

| Tool | Description |
|------|-------------|
| `wyrm_search` | Full-text search across all projects, sessions, quests |
| `wyrm_sync` | Sync database with `.wyrm/` markdown files |
| `wyrm_stats` | Database statistics and health |
| `wyrm_maintenance` | Vacuum, archive old data, optimize indexes |

---

## Project Structure

### Per-Project Files

Each project tracked by Wyrm gets a `.wyrm/` directory:

```
project/
└── .wyrm/
    ├── hoard.md        # 🐉 Project knowledge — architecture, decisions, context
    ├── chronicles.md   # 📜 Session history — what was discussed and built
    ├── quests.md       # ⚔️ Task queue — pending and completed work
    └── protocol.md     # 🔥 AI guidelines — project-specific instructions
```

### Repository Structure

```
Wyrm/
├── packages/
│   ├── mcp-server/            # MCP server (stdio mode for AI tools)
│   └── vscode-extension/      # VS Code extension
├── config/                    # Configuration templates
├── templates/                 # Project template files
├── examples/                  # Usage examples
├── docs/                      # Documentation
├── install.sh                 # Installation script
├── wyrm-deploy.sh             # Multi-project deployment
├── Dockerfile                 # Container build
├── CHANGELOG.md
├── ROADMAP.md
├── SECURITY_AUDIT.md
└── SECURITY_AUDIT_V2.md
```

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    AI Assistant                          │
│              (Copilot, Claude, GPT)                      │
└─────────────────────┬───────────────────────────────────┘
                      │ MCP Protocol (stdio)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Wyrm MCP Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Logger    │  │   Crypto    │  │    Sync     │     │
│  │  (Winston)  │  │ (AES-256)  │  │ (Markdown)  │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│  ┌─────────────────────────────────────────────────┐   │
│  │           SQLite Database (WAL mode)             │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐  │   │
│  │  │Projects │ │Sessions │ │ Quests  │ │ FTS5  │  │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────┘  │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐            │   │
│  │  │DataLake │ │ Context │ │ Tokens  │            │   │
│  │  └─────────┘ └─────────┘ └─────────┘            │   │
│  └─────────────────────────────────────────────────┘   │
│                      │                                  │
│               HTTP API (:3333)                          │
└─────────────────────────────────────────────────────────┘
```

---

## HTTP API

```
GET  /api/health              Health check
GET  /api/stats               Database statistics
GET  /api/projects            List all projects
POST /api/scan                Scan directory for git projects
GET  /api/project/:path       Get full project context
POST /api/session/start       Start or continue session
POST /api/session/update      Update session with work
POST /api/quest               Add quest
POST /api/data                Insert data point
GET  /api/search?q=...        Full-text search
```

---

## Docker

```bash
# Pull latest image
docker pull ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest

# Run HTTP server
docker run -p 3333:3333 -v wyrm-data:/data ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest

# Health check
curl http://localhost:3333/health
```

---

## CI/CD

Wyrm uses GitHub Actions for comprehensive automation:

| Workflow | Description |
|----------|-------------|
| **CI** | Automated builds and tests on Node.js 18, 20, 22 |
| **Security** | Weekly CodeQL analysis and dependency audits |
| **Performance** | Automated benchmarks and load tests |
| **Integration** | Cross-platform tests (Ubuntu, macOS, Windows) |
| **Docker** | Automated image builds pushed to GitHub Container Registry |
| **Docs** | Auto-deployed to GitHub Pages |

See [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md) for complete workflow documentation.

---

## Security

| Feature | Detail |
|---------|--------|
| **Local-Only** | All data stored locally — nothing leaves your machine by default |
| **AES-256-GCM** | Optional encryption for sensitive context data |
| **No Telemetry** | Zero data collection, zero phone-home |
| **Audited** | Two security audits completed ([v1](SECURITY_AUDIT.md), [v2](SECURITY_AUDIT_V2.md)) |
| **Sandboxed** | No network access required for MCP server operation |

---

## Ghost Protocol Ecosystem

Wyrm is part of the Ghost Protocol product suite:

| Product | Description | Status |
|---------|-------------|--------|
| **Wyrm** | Persistent AI memory system (this project) | v3.0.0 — Production |
| **PhantomDragon AI** | AI-powered penetration testing framework | v2.2.0 — Production |
| **[PhantomDragon](https://github.com/ghosts-lk/PhantomDragon)** | Core web application pentesting framework | v9.0.0 — Production |
| **[Ghost Protocol](https://ghosts.lk)** | Enterprise web portfolio & knowledge base | Production |
| **[DragonScale](https://ghosts.lk/dragonscale)** | Security audit & compliance platform | Development |

---

## License

**Proprietary** — Copyright © 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.

See [LICENSE](LICENSE) for full terms. For licensing inquiries: legal@ghosts.lk

---

<div align="center">

*The dragon remembers. 🐉*

*Built by [Ghost Protocol](https://ghosts.lk)*

</div>
