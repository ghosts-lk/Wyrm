# Wyrm Protocol // DragonScale

> Guidelines for AI working on this project

## Session Start

Read these files first:
- .wyrm/hoard.md
- .wyrm/chronicles.md
- .wyrm/quests.md

Check status:
```bash
git log --oneline -5
git status
```

## Commands

```bash
# Start dev server
php -S localhost:8000

# Check database
php -r "require 'config/database.php'; print_r(getDB()->query('SELECT * FROM upalis_settings')->fetchAll());"

# Test login
curl -c /tmp/c.txt -X POST "http://localhost:8000/admin/index.php" \
  -d "username=admin&password=Admin@12345"
```

## Code Rules

- PHP 8.4 syntax allowed
- PDO with prepared statements only
- Include bootstrap-security.php first
- CSRF on all forms
- Use datetime('now') for SQLite, NOW() for MySQL

## Common Issues

1. **Can't login:** Check session.cookie_secure (0 for HTTP)
2. **CSRF errors:** Ensure bootstrap-security.php included before session ops
3. **SQL errors:** Check SQLite vs MySQL syntax differences

## Session End

1. Update chronicles.md with what was done
2. Update quests.md (mark complete, add new)
3. Update hoard.md if architecture changed
4. Commit and push
