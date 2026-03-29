# Registering Professional Lead Scraping Skill with Wyrm

Now that Wyrm supports skill management, you can register your professional lead scraping skill to make it discoverable and trackable.

## Quick Registration

Use Wyrm's new `wyrm_skill_register` tool to register the skill:

```json
{
  "name": "professional-lead-scraping",
  "description": "Extract professional leads (names, emails, phone numbers, company data) from multiple sources. Use for: building prospect lists, enriching contact databases, sales research, multi-platform lead generation across LinkedIn, company websites, databases, and email services.",
  "skillPath": "/home/kami/.copilot/skills/professional-lead-scraping",
  "category": "data-extraction",
  "author": "Ghost Protocol",
  "version": "1.0.0",
  "tags": "scraping,leads,email-validation,linkedin,hunter.io,sales,prospect-research,data-extraction,crunchbase,apollo"
}
```

## Step-by-Step Registration

### 1. Open any chat with Copilot and request skill registration:

```
Register my professional-lead-scraping skill with Wyrm so it can be discovered later
```

### 2. Copilot will call:

```
wyrm_skill_register({
  name: "professional-lead-scraping",
  description: "Extract professional leads (names, emails, phone numbers, company data) from multiple sources...",
  skillPath: "/home/kami/.copilot/skills/professional-lead-scraping",
  category: "data-extraction",
  author: "Ghost Protocol",
  version: "1.0.0",
  tags: "scraping,leads,email-validation,linkedin,hunter.io,sales,prospect-research"
})
```

### 3. Wyrm stores the skill metadata in its database and returns:

```
🐉 **Skill Registered**

Name: professional-lead-scraping
Path: /home/kami/.copilot/skills/professional-lead-scraping
Category: data-extraction
Version: 1.0.0
Status: Active
```

## Discovering the Skill Later

### List all active data extraction skills:
```
List all my data extraction skills
```

→ Calls `wyrm_skill_list({ active: true, category: "data-extraction" })`

### Search for skills related to email:
```
Find all skills related to email scraping and validation
```

→ Calls `wyrm_skill_search({ query: "email scraping validation" })`

### Get skill details:
```
Show me details about the professional-lead-scraping skill
```

→ Calls `wyrm_skill_get({ name: "professional-lead-scraping" })`

## Using Skills in Your Workflow

### Scenario: Starting a new sales research task

```
User: I need to research companies in the SaaS industry for a sales campaign

Copilot: Based on registered skills, you might use:
- wyrm_skill_get("professional-lead-scraping") 
  → Returns skill details, path to SKILL.md, usage examples

User: Cool! Use the professional-lead-scraping skill to help me
```

### Scenario: Finding related skills

```
User: I have a CSV of company names and want to enrich them with contact data

Copilot: Searching Wyrm for related skills...
- wyrm_skill_search("email validation enrichment")

Returns:
- professional-lead-scraping (email-validator.py, duplicate-remover.py)
- [other related skills]
```

## Tracking Usage

Every time you use the professional lead scraping skill, Wyrm automatically:
1. Increments the usage counter
2. Updates the `last_used` timestamp
3. Keeps it indexed for fast discovery

```sql
SELECT name, usage_count, last_used FROM skills 
WHERE name = 'professional-lead-scraping';

-- Example output:
-- professional-lead-scraping | 5 | 2025-03-29T14:32:00Z
```

## Skill Components Documented in Wyrm

When registered, Wyrm tracks:

| Component | Value | Where to Find |
|-----------|-------|---------------|
| **Skill Name** | professional-lead-scraping | `~/.copilot/skills/` folder |
| **Description** | Full feature list | `SKILL.md` header |
| **Path** | `/home/kami/.copilot/skills/professional-lead-scraping` | File system location |
| **Category** | data-extraction | Based on use case |
| **Scripts** | email-validator.py, duplicate-remover.py | `./scripts/` folder |
| **References** | compliance.md, architecture.md | `./references/` folder |
| **Templates** | Export formats, examples | `./assets/` folder |

## Integration with Other Wyrm Features

### 1. Global Search
```
Search across everything for "professional leads"

→ wyrm_search({ query: "professional leads", type: "all" })

Results:
- Sessions: "Working on lead enrichment" (2 matches)
- Quests: "Gather 100 qualified leads" (3 matches)
- Skills: professional-lead-scraping (1 match)
- Data: Lead batch exports (5 matches)
```

### 2. Project-Specific Data Lake

Store lead scraping results tied to a project:

```
wyrm_data_insert({
  projectPath: "/home/kami/Git Projects/MyProject",
  category: "leads-scraped",
  key: "batch-2025-03-29-saas",
  value: "{ ... 250 leads ... }",
  metadata: { 
    skill: "professional-lead-scraping",
    source: "linkedin,hunter.io",
    confidence_min: 75
  }
})
```

Then query later:
```
wyrm_data_query({
  projectPath: "/home/kami/Git Projects/MyProject",
  category: "leads-scraped"
})
```

### 3. Quest Management

Track skill usage in project quests:

```
wyrm_quest_add({
  projectPath: "/home/kami/Git Projects/MyProject",
  title: "Research 50 SaaS companies using professional-lead-scraping",
  description: "Use the professional-lead-scraping skill to gather contact data",
  priority: "high",
  tags: "scraping,research,sales"
})
```

### 4. Session Notes

Log when you use the skill:

```
wyrm_session_update({
  projectPath: "/home/kami/Git Projects/MyProject",
  completed: "Used professional-lead-scraping to gather 250 leads",
  notes: "Skill performed well, 88% email verification rate"
})
```

## Maintenance

### Update Skill Metadata
When the skill is updated (new version, additional features):

```
Ask Copilot to update the professional-lead-scraping skill to version 1.1.0
```

### Check Skill Statistics
```
Show me statistics about my registered skills

→ wyrm_skill_stats()

Total Skills: 12
Active Skills: 11
Inactive Skills: 1

By Category:
- data-extraction: 3
- testing: 4
- documentation: 2
- ...
```

### Deactivate (Don't Delete)
If you're not using a skill but might later:

```
Deactivate the professional-lead-scraping skill but keep it registered

→ wyrm_skill_deactivate("professional-lead-scraping")
```

### Reactivate When Needed
```
Activate the professional-lead-scraping skill again

→ wyrm_skill_activate("professional-lead-scraping")
```

### Delete Permanently
Only if completely obsolete:

```
Delete the professional-lead-scraping skill permanently

→ wyrm_skill_delete("professional-lead-scraping")
```

## Files Included in Professional Lead Scraping Skill

When registered, Wyrm indexes all these components:

### Core Documentation
- `SKILL.md` (500+ lines) - Complete skill guide
- `QUICK-REFERENCE.md` - Checklists and quick commands

### References
- `compliance.md` - GDPR, CCPA, legal guidance
- `architecture.md` - Technical deep dives, API setup

### Scripts
- `email-validator.py` - Email enrichment (300+ lines)
- `duplicate-remover.py` - Deduplication (350+ lines)
- `scripts/README.md` - Script documentation

### Templates
- `data-export-template.json` - JSON export format
- `data-export-template.csv` - CSV export format

## Next Steps

1. ✅ **Register the skill**: Use `wyrm_skill_register()` tool
2. ✅ **Verify registration**: Use `wyrm_skill_get()` or `wyrm_skill_list()`
3. ✅ **Use in projects**: Reference skill in quests and sessions
4. ✅ **Track results**: Store leads in data lake with skill attribution
5. ✅ **Monitor usage**: Check `wyrm_skill_stats()` periodically

## Related Documentation

- [Skill Management Overview](../docs/SKILL_MANAGEMENT.md)
- [Skill Enhancement Details](../SKILL_MANAGEMENT_ENHANCEMENT.md)
- [Professional Lead Scraping Skill](../.copilot/skills/professional-lead-scraping/SKILL.md)
- [Wyrm Data Lake](./DATA_LAKE.md)
- [Wyrm Search](./SEARCH.md)

---

**Wyrm Version**: 3.1.0+  
**Date**: March 29, 2026
