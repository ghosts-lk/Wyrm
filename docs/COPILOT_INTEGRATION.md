# 🐉 Wyrm + GitHub Copilot Integration

## How It Works

Wyrm integrates with GitHub Copilot in two ways:

1. **MCP Server** - Real-time context injection via Model Context Protocol
2. **Copilot Instructions** - Static context via `.github/copilot-instructions.md`

---

## Setup Option 1: MCP Server (Recommended)

The MCP server provides dynamic, real-time context to Copilot Chat.

### Step 1: Build the MCP Server

```bash
cd Wyrm/packages/mcp-server
npm install
npm run build
```

### Step 2: Configure VS Code

Add to your VS Code `settings.json`:

```json
{
  "github.copilot.chat.experimental.mcpServers": {
    "wyrm": {
      "command": "node",
      "args": ["/path/to/Wyrm/packages/mcp-server/dist/index.js"]
    }
  }
}
```

Or for global install:

```bash
npm link  # From packages/mcp-server
```

Then use:

```json
{
  "github.copilot.chat.experimental.mcpServers": {
    "wyrm": {
      "command": "wyrm-mcp"
    }
  }
}
```

### Step 3: Use in Copilot Chat

Once configured, you can use Wyrm tools in Copilot Chat:

```
@wyrm show project context
@wyrm what are my pending quests?
@wyrm start session with objective "Fix auth bug"
@wyrm save session
```

---

## Setup Option 2: Copilot Instructions (Simpler)

If MCP isn't working, use static instructions.

### Automatic (via wyrm-deploy)

```bash
wyrm-deploy /path/to/projects
```

This creates `.github/copilot-instructions.md` in each project.

### Manual

Create `.github/copilot-instructions.md`:

```markdown
# Copilot Instructions

This project uses Wyrm for AI memory.

Before making changes, read:
- `.wyrm/hoard.md` - Project architecture
- `.wyrm/quests.md` - Pending tasks
- `.wyrm/chronicles.md` - Recent history
```

Copilot Chat automatically loads this file.

---

## Available MCP Tools

When using the MCP server, these tools are available:

| Tool | Description |
|------|-------------|
| `wyrm_scan_projects` | Discover projects in a directory |
| `wyrm_list_projects` | List registered projects |
| `wyrm_project_context` | Get full context for a project |
| `wyrm_global_context` | Overview of all projects |
| `wyrm_session_start` | Start a new session |
| `wyrm_session_save` | Save session progress |
| `wyrm_quest_add` | Add a new task |
| `wyrm_quest_complete` | Mark task complete |
| `wyrm_search` | Search across all context |

---

## Example Workflow

### Start of Day

```
You: @wyrm show my pending quests across all projects

Wyrm: Here are your pending quests:

Ghost Protocol:
- [ ] Blog content & technical articles

Phantom Dragon:
- [ ] Payload expansion (WAF bypass)

Upalis:
- [ ] Production deployment
- [ ] PayHere integration
```

### Working on a Project

```
You: @wyrm start session on Upalis with objective "Implement PayHere webhooks"

Wyrm: Session started for Upalis
Objective: Implement PayHere webhooks

Here's the relevant context:
- PayHere integration is in progress (see hoard.md)
- Last session fixed SQLite datetime issues
- Admin credentials: admin / Admin@12345
```

### End of Session

```
You: @wyrm save session - completed webhook handler, tested with sandbox

Wyrm: Session saved to chronicles.md
- Completed: Webhook handler implementation
- Files changed will be auto-detected from git
```

---

## Troubleshooting

### MCP not connecting

1. Check VS Code version (needs 1.85+)
2. Verify server is built: `ls packages/mcp-server/dist/index.js`
3. Check VS Code output panel for errors

### Copilot not reading instructions

1. Verify file is at `.github/copilot-instructions.md`
2. Check it's not in `.gitignore`
3. Restart VS Code

### Context not updating

The MCP server reads from the database. If you manually edit `.wyrm/*.md` files, run:

```
@wyrm sync
```

---

## Notes

- MCP is still experimental in Copilot (as of Feb 2026)
- Both methods can be used together
- The `.github/copilot-instructions.md` is always available as fallback
