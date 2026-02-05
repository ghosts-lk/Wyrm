# 🐉 Wyrm

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

[![License: Proprietary](https://img.shields.io/badge/License-Proprietary-red.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/Node.js-18+-green.svg)](https://nodejs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0-blue.svg)](https://www.typescriptlang.org/)

[![CI](https://github.com/ghosts-lk/Wyrm/workflows/CI/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/ci.yml)
[![Security](https://github.com/ghosts-lk/Wyrm/workflows/Security/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/security.yml)
[![Integration](https://github.com/ghosts-lk/Wyrm/workflows/Integration%20Tests/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/integration.yml)
[![Performance](https://github.com/ghosts-lk/Wyrm/workflows/Performance/badge.svg)](https://github.com/ghosts-lk/Wyrm/actions/workflows/performance.yml)

## Overview

**Wyrm** is a persistent memory system for AI-assisted development. It maintains context across chat sessions, enabling AI assistants to remember project details, track work sessions, and manage tasks.

### Key Features

| Feature | Description |
|---------|-------------|
| 🧠 **Persistent Memory** | SQLite-backed storage that survives across sessions |
| 🔍 **Full-Text Search** | Fast FTS5 search across sessions, quests, and data |
| 🔐 **AES-256 Encryption** | Optional encryption for sensitive context data |
| 🚀 **MCP Protocol** | Native Model Context Protocol support for AI tools |
| 📊 **Data Lake** | Store large datasets with batch operations |
| 🔄 **Auto-Sync** | Bi-directional sync with \`.wyrm/\` markdown files |
| 🎯 **Quest Management** | Track tasks with priorities and tags |
| 📈 **Token Tracking** | Automatic token estimation for context budgeting |

## Installation

### Option 1: NPM (Recommended)

\`\`\`bash
npm install -g @wyrm/mcp-server
\`\`\`

### Option 2: From Source

\`\`\`bash
git clone https://github.com/Ghosts-Protocol-Pvt-Ltd/Wyrm.git
cd Wyrm/packages/mcp-server
npm install && npm run build
npm link
\`\`\`

### Option 3: Auto-Deploy to Projects

\`\`\`bash
wyrm-deploy /path/to/your/projects
\`\`\`

## Quick Start

### 1. Configure with GitHub Copilot

Add to your VS Code settings (\`.vscode/settings.json\`):

\`\`\`json
{
  "github.copilot.chat.experimental.mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
\`\`\`

### 2. Start the HTTP Server (Optional)

\`\`\`bash
wyrm  # Starts on http://localhost:3333
\`\`\`

### 3. Scan Your Projects

In Copilot Chat:
\`\`\`
@wyrm Scan /home/user/projects for git repositories
\`\`\`

## Commands

| Command | Description |
|---------|-------------|
| \`wyrm-mcp\` | Start MCP server (stdio mode for AI tools) |
| \`wyrm\` | Start HTTP API server on port 3333 |
| \`wyrm-deploy <path>\` | Deploy Wyrm to all projects in a folder |

## MCP Tools

### Project Management
- \`wyrm_scan_projects\` - Discover git projects in a directory
- \`wyrm_list_projects\` - List all registered projects
- \`wyrm_project_context\` - Get full context for a project
- \`wyrm_global_context\` - Overview of all projects

### Session Management
- \`wyrm_session_start\` - Start or continue a session
- \`wyrm_session_update\` - Update with completed work

### Quest Management
- \`wyrm_quest_add\` - Add a task with priority
- \`wyrm_quest_complete\` - Mark task as done
- \`wyrm_all_quests\` - List pending tasks across projects

### Data Lake
- \`wyrm_data_insert\` - Store data points
- \`wyrm_data_batch_insert\` - Bulk insert data
- \`wyrm_data_query\` - Query stored data

### Search & Maintenance
- \`wyrm_search\` - Full-text search across all data
- \`wyrm_sync\` - Sync database with \`.wyrm/\` folders
- \`wyrm_stats\` - Database statistics
- \`wyrm_maintenance\` - Vacuum and archive

## HTTP API

\`\`\`
GET  /api/health              - Health check
GET  /api/stats               - Database statistics
GET  /api/projects            - List projects
POST /api/scan                - Scan for projects
GET  /api/project/:path       - Get project context
POST /api/session/start       - Start session
POST /api/session/update      - Update session
POST /api/quest               - Add quest
POST /api/data                - Insert data
GET  /api/search?q=...        - Search
\`\`\`

## Project Structure

\`\`\`
project/
└── .wyrm/
    ├── hoard.md        # 🐉 Project knowledge
    ├── chronicles.md   # 📜 Session history
    ├── quests.md       # ⚔️ Task queue
    └── protocol.md     # 🔥 AI guidelines
\`\`\`

## Architecture

\`\`\`
┌─────────────────────────────────────────────────────────┐
│                    AI Assistant                         │
│              (Claude, GPT, Copilot)                     │
└─────────────────────┬───────────────────────────────────┘
                      │ MCP Protocol
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  Wyrm MCP Server                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐     │
│  │   Logger    │  │   Crypto    │  │    Sync     │     │
│  └─────────────┘  └─────────────┘  └─────────────┘     │
│  ┌─────────────────────────────────────────────────┐   │
│  │               SQLite Database                    │   │
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────┐  │   │
│  │  │Projects │ │Sessions │ │ Quests  │ │  FTS  │  │   │
│  │  └─────────┘ └─────────┘ └─────────┘ └───────┘  │   │
│  └─────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
\`\`\`

## Security

- **Local-Only**: All data stored locally by default
- **AES-256-GCM**: Optional encryption for sensitive data
- **No Telemetry**: Zero data collection
- **MIT Licensed**: Open source and auditable

## CI/CD & Automation

Wyrm uses GitHub Actions for automated testing, releases, and deployments:

- **Continuous Integration**: Automated builds on Node.js 18, 20, 22
- **Security Scanning**: Weekly CodeQL analysis and dependency audits
- **Performance Testing**: Automated benchmarks and load tests
- **Cross-Platform**: Tested on Ubuntu, macOS, and Windows
- **Docker**: Automated image builds pushed to GitHub Container Registry
- **Documentation**: Auto-deployed to GitHub Pages

See [GITHUB_ACTIONS.md](GITHUB_ACTIONS.md) for complete workflow documentation.

### Docker

```bash
# Pull latest image
docker pull ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest

# Run HTTP server
docker run -p 3333:3333 -v wyrm-data:/data ghcr.io/ghosts-protocol-pvt-ltd/wyrm:latest

# Access API
curl http://localhost:3333/health
```

## Ghost Protocol Ecosystem

Wyrm is part of the Ghost Protocol product suite:

| Product | Description |
|---------|-------------|
| **[Wyrm](https://github.com/ghosts-lk/Wyrm)** | Persistent AI memory system for development |
| **[Foundry](https://github.com/ghosts-lk/Foundry)** | Enterprise website development framework |
| **[PhantomDragon](https://github.com/ghosts-lk/PhantomDragon)** | Web application penetration testing framework |
| **[DragonScale](https://ghosts.lk/dragonscale)** | Security audit & compliance platform |
| **[DragonKeep](https://ghosts.lk/dragonkeep)** | Secure infrastructure management |

### Foundry Integration

Wyrm integrates seamlessly with Foundry projects:

```bash
# In a Foundry project, initialize Wyrm
foundry wyrm init

# Sync with AI memory
foundry wyrm sync
```

This enables AI assistants to maintain project context, track tasks, and coordinate multi-agent workflows.

## License

**Proprietary** - Copyright (c) 2026 Ghost Protocol (Pvt) Ltd. All Rights Reserved.

See [LICENSE](LICENSE) for full terms. For licensing inquiries, contact legal@ghosts.lk

## Credits

Developed by [Ghost Protocol](https://ghosts.lk)

---

<p align="center">
  <sub>The dragon remembers. 🐉</sub>
</p>
