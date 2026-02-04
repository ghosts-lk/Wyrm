# Wyrm MCP Configuration

Add Wyrm to your AI tool to enable automatic context injection.

## Claude Desktop

Add to `~/.config/claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "node",
      "args": ["/path/to/Wyrm/packages/mcp-server/dist/index.js"],
      "env": {
        "WYRM_DB_PATH": "~/.wyrm/wyrm.db"
      }
    }
  }
}
```

## Cursor

Add to `.cursor/mcp.json` in your project:

```json
{
  "mcpServers": {
    "wyrm": {
      "command": "npx",
      "args": ["@wyrm/mcp-server"],
      "env": {}
    }
  }
}
```

## VS Code with Copilot

The VS Code extension automatically creates `.github/copilot-instructions.md` to guide Copilot to read the .wyrm folder.

## Generic MCP Client

```javascript
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const transport = new StdioClientTransport({
  command: "node",
  args: ["/path/to/wyrm/packages/mcp-server/dist/index.js"]
});

const client = new Client({
  name: "my-app",
  version: "1.0.0"
});

await client.connect(transport);

// Get project context
const context = await client.callTool({
  name: "wyrm_context",
  arguments: { projectPath: "/path/to/your/project" }
});
```

## Available MCP Tools

| Tool | Description |
|------|-------------|
| `wyrm_context` | Get full project context for AI prompt |
| `wyrm_session_start` | Start or continue a session |
| `wyrm_session_update` | Update session with completed work |
| `wyrm_quest_add` | Add a new task |
| `wyrm_quest_complete` | Mark a task as done |
| `wyrm_sync` | Sync database with .wyrm folder |
| `wyrm_stats` | Get usage statistics |
