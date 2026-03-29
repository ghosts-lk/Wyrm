# Wyrm Skill Management

Wyrm now integrates with Copilot Skills, allowing you to register, track, and manage skills directly from the AI memory system.

## Features

- **Register Skills**: Store skill metadata (name, description, path, category, author, version)
- **Track Usage**: Automatic tracking of skill usage counts and last access times
- **Search Skills**: Full-text search across skill descriptions, tags, and names
- **Activate/Deactivate**: Easily enable or disable skills without deletion
- **Categorization**: Organize skills by category for better discovery
- **Statistics**: Get overview of registered skills and their status

## MCP Tools

### wyrm_skill_register
Register a new skill or update existing skill metadata.

```json
{
  "name": "professional-lead-scraping",
  "description": "Extract professional leads from multiple sources",
  "skillPath": "/home/user/.copilot/skills/professional-lead-scraping",
  "category": "data-extraction",
  "author": "Your Name",
  "version": "1.0.0",
  "tags": "scraping,leads,email-validation"
}
```

### wyrm_skill_list
List all registered skills with optional filtering.

```json
{
  "active": true,
  "category": "data-extraction",
  "search": "scraping"
}
```

### wyrm_skill_get
Get detailed information about a specific skill.

```json
{
  "name": "professional-lead-scraping"
}
```

### wyrm_skill_search
Search for skills by name, description, or tags.

```json
{
  "query": "email validation scraping",
  "limit": 20
}
```

### wyrm_skill_activate / wyrm_skill_deactivate
Enable or disable a skill without deleting it.

```json
{
  "name": "professional-lead-scraping"
}
```

### wyrm_skill_delete
Permanently remove a skill from the registry.

```json
{
  "name": "professional-lead-scraping"
}
```

### wyrm_skill_stats
Get statistics about all registered skills.

```json
{}
```

## Usage Examples

### Register the Professional Lead Scraping Skill

```
User: Use Wyrm skill management to register the professional-lead-scraping skill I just created
```

```json
wyrm_skill_register({
  "name": "professional-lead-scraping",
  "description": "Extract professional leads (names, emails, phone numbers, company data) from multiple sources including LinkedIn, company websites, B2B databases, and email services",
  "skillPath": "/home/kami/.copilot/skills/professional-lead-scraping",
  "category": "data-extraction",
  "author": "Ghost Protocol",
  "version": "1.0.0",
  "tags": "scraping,leads,email-validation,linkedin,hunter.io,sales,prospect-research"
})
```

### List All Data Extraction Skills

```
User: Show me all data extraction skills I've registered
```

```json
wyrm_skill_list({
  "active": true,
  "category": "data-extraction"
})
```

### Search for Skills Related to Email

```
User: Find all skills related to email
```

```json
wyrm_skill_search({
  "query": "email validation",
  "limit": 10
})
```

### Global Search Including Skills

```
User: Search across everything for "scraping"
```

```json
wyrm_search({
  "query": "scraping",
  "type": "skills"
})
```

## Integration with Copilot Skills

When you register a skill in Wyrm, it tracks:

1. **Path**: Where the skill lives (`~/.copilot/skills/name` or project path)
2. **Metadata**: Author, version, category, tags for discovery
3. **Usage**: Automatic counting of how many times the skill is invoked
4. **Status**: Active/inactive state without deletion
5. **Timestamps**: When created, updated, and last used

This enables:
- **Discovering skills** by category, author, or tags
- **Tracking skill adoption** across projects
- **Managing skill lifecycle** (activate/deactivate/delete)
- **Searching for related skills** when working on similar tasks

## Database Schema

```sql
CREATE TABLE skills (
  id INTEGER PRIMARY KEY,
  name TEXT UNIQUE,
  description TEXT,
  skill_path TEXT,
  category TEXT,
  author TEXT,
  version TEXT,
  tags TEXT,
  is_active INTEGER,
  usage_count INTEGER,
  last_used TEXT,
  created_at TEXT,
  updated_at TEXT
);

CREATE VIRTUAL TABLE skills_fts USING fts5(
  name, description, tags,
  content='skills', content_rowid='id'
);
```

## Performance

- **Full-text search**: Instant results via FTS5 index
- **Update tracking**: Automatic usage counters and timestamps
- **Caching**: Read-only skill operations cached for 30 seconds
- **Batch operations**: Skills table indexed for fast lookups

## Next Steps

1. **Register existing skills** from `~/.copilot/skills/` and project `.github/skills/`
2. **Use skill search** to discover relevant skills when starting new tasks
3. **Monitor skill usage** via statistics and search results
4. **Organize by category** for better team collaboration

## Related Documentation

- [Skill.md Format](../README.md#skills-and-prompts)
- [Copilot Customization](../README.md)
- [Data Lake Queries](./DATA_LAKE.md)
- [Search & Discovery](./SEARCH.md)
