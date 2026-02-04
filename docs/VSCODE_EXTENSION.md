# Wyrm VS Code Extension

Automatic memory management for AI-assisted development.

## Features

### 🔄 Auto-Load
When you open a workspace with a `.wyrm/` folder, the extension automatically:
- Loads project context into the sidebar
- Starts a new session for today
- Syncs database with local files

### 💾 Auto-Save
When you close the workspace:
- Current session is saved
- Git commits are recorded
- Changes are exported to `.wyrm/` folder

### 📊 Sidebar Views
- **Context** - Project architecture and key info
- **Quests** - Prioritized task list with status
- **Sessions** - Recent session history

### ⚡ Commands
Open Command Palette (`Ctrl+Shift+P`) and type "Wyrm":

| Command | Description |
|---------|-------------|
| `Wyrm: Initialize Memory` | Create .wyrm folder in current project |
| `Wyrm: Show Context` | View full project context |
| `Wyrm: Start Session` | Begin a new coding session |
| `Wyrm: Save Session` | Save current session progress |
| `Wyrm: Add Quest` | Add a new task |
| `Wyrm: Complete Quest` | Mark a task as done |
| `Wyrm: Sync` | Sync database with .wyrm folder |

## Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `wyrm.autoInjectContext` | `true` | Auto-inject context on session start |
| `wyrm.autoSaveOnClose` | `true` | Auto-save session on workspace close |
| `wyrm.maxContextTokens` | `4000` | Max tokens for context bundle |
| `wyrm.databasePath` | `~/.wyrm/wyrm.db` | Path to SQLite database |

## Installation

### From VSIX (Recommended)

```bash
cd packages/vscode-extension
npm install
npm run compile
npx vsce package
code --install-extension wyrm-1.0.0.vsix
```

### Development Mode

```bash
cd packages/vscode-extension
npm install
npm run compile
# Press F5 in VS Code to launch Extension Host
```

## How It Works

1. **Detection**: Extension looks for `.wyrm/` folder in workspace
2. **Import**: Parses markdown files into SQLite database
3. **Session**: Creates/continues daily session automatically
4. **Watch**: Monitors file changes and syncs bidirectionally
5. **Export**: On save/close, writes database back to markdown
6. **Copilot**: Creates `.github/copilot-instructions.md` for integration

## Data Storage

- **Local files**: `.wyrm/*.md` in each project
- **Database**: `~/.wyrm/wyrm.db` (or custom path)
- **Sync**: Bidirectional, files take precedence on conflict
