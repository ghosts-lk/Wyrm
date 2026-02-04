# 🐉 Wyrm

```
██╗    ██╗██╗   ██╗██████╗ ███╗   ███╗
██║    ██║╚██╗ ██╔╝██╔══██╗████╗ ████║
██║ █╗ ██║ ╚████╔╝ ██████╔╝██╔████╔██║
██║███╗██║  ╚██╔╝  ██╔══██╗██║╚██╔╝██║
╚███╔███╔╝   ██║   ██║  ██║██║ ╚═╝ ██║
 ╚══╝╚══╝    ╚═╝   ╚═╝  ╚═╝╚═╝     ╚═╝
    Persistent AI Memory System
           ghosts.lk
```

> *"The ancient wyrm remembers all. What was spoken, what was built, what remains undone."*

## What is Wyrm?

**Wyrm** is a **fully automated, infinite** persistent memory system for AI-assisted development. It maintains context across chat sessions, so your AI assistant always knows:

- 📜 **What the project is** - Architecture, stack, key decisions
- 🔥 **What was done** - Session history with commits and changes  
- ⚔️ **What remains** - Prioritized mission queue
- 🐲 **How to operate** - Project-specific protocols

## 🚀 Automation Features

Wyrm includes two powerful automation tools:

### MCP Server (Model Context Protocol)
- **Auto-injects** project context into AI conversations
- **Infinite storage** via SQLite database
- **Auto-summarizes** old sessions to manage token limits
- Works with Claude, GPT, and any MCP-compatible AI

### VS Code Extension
- **Auto-loads** .wyrm folder when you open a project
- **Auto-saves** sessions when you close the workspace
- **Sidebar views** for quests, sessions, and context
- **One-click** commands for common operations

## Quick Start

### Option 1: Auto-Deploy (Multi-Project)

Automatically scan a folder and deploy Wyrm to all projects:

```bash
# Run from the Wyrm folder
./wyrm-deploy.sh /path/to/your/projects

# Or install globally
sudo ln -sf "$(pwd)/wyrm-deploy.sh" /usr/local/bin/wyrm-deploy
wyrm-deploy /path/to/your/projects
```

This will:
- Scan all subdirectories
- Detect project types (Next.js, Python, PHP, etc.)
- Create `.wyrm/` folders with appropriate templates
- Create a unified workspace-level `.wyrm/` for cross-project memory

### Option 2: MCP Server + VS Code Extension

```bash
# Install MCP Server globally
cd Wyrm/packages/mcp-server
npm install && npm run build
npm link

# Install VS Code Extension
cd ../vscode-extension
npm install && npm run compile
# Then install the .vsix or run in dev mode
```

### Option 3: Manual (Single Project)

```bash
# Install in your project
curl -sSL https://raw.githubusercontent.com/ghosts-lk/Wyrm/main/install.sh | bash
```

### Option 4: Git Submodule

```bash
git submodule add https://github.com/ghosts-lk/Wyrm.git .wyrm
cd .wyrm && ./install.sh
```

## File Structure

```
.wyrm/
├── README.md           # This file
├── hoard.md            # 🐉 Project knowledge (the dragon's treasure)
├── chronicles.md       # 📜 Session history (tales of old)
├── quests.md           # ⚔️ Mission queue (battles to fight)
├── protocol.md         # 🔥 AI operating guidelines
└── templates/          # Empty templates for new projects
    ├── hoard.template.md
    ├── chronicles.template.md
    └── quests.template.md
```

## The Dragon's Hoard

Your `hoard.md` contains the knowledge the wyrm guards:

```markdown
# 🐉 Wyrm Hoard

## Project
- Name, stack, repo URLs

## Architecture  
- Key files, database, APIs

## Credentials
- Dev passwords, API keys (local only!)

## Decisions
- ADRs, why things are the way they are
```

## Chronicles

The `chronicles.md` records every session:

```markdown
## Session: 2026-02-04

### Quests Completed
- Fixed authentication bug
- Added rate limiting

### Commits
- `abc123` - Fix auth flow

### Files Changed
- src/auth.js
- config/security.js
```

## Why "Wyrm"?

In mythology, **wyrms** are ancient dragons - serpentine, wise, and immortal. They guard hoards of treasure accumulated over centuries.

Your AI's context is treasure. Without it, every session starts from zero. **Wyrm** ensures the dragon remembers.

## Example

See [examples/dragonscale/](examples/dragonscale/) for a real-world example from an active project.

## Part of Ghost Protocol

Wyrm is a [ghosts-lk](https://github.com/ghosts-lk) project.

```
👻 Ghost Protocol
├── DragonScale  - Restaurant ordering system
├── Wyrm         - AI memory system (you are here)
└── ...more to come
```

---

*The wyrm sleeps, but never forgets.* 🐉
